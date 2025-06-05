import * as redisLocal from "@adent/redis-local";

let clients = new Map();

let jobs = new Map();

let callbacks = new Map();

const registerCallback = (jobId, taskId, fn) => {
    callbacks.set(`${jobId}:${taskId}`, fn);
}

export const registerJob = (jobId, fn) => {
    jobs.set(jobId, fn);
}

const getOrCreateClient = (clientId) => {
    if (!clients.has(clientId)) {
        clients.set(clientId, {
            id: clientId,
            tasks: new Map(),
            jobs: new Map()
        });
    }
    return clients.get(clientId);
}

const getClient = (clientId) => {
    return clients.get(clientId);
}

export const finishClient = async (clientId) => {
    //...
    let client = getClient(clientId);
    if (client) {
        let redis = await redisLocal.getClient();
        let jobs = Array.from(client.jobs.keys());
        console.log("client found ... finishing!");
        for (let jobId of jobs) {
            let job = client.jobs.get(jobId);
            let index = 0;
            let tasksKeys = Array.from(job.tasks.keys());
            let tasksData = [];
            for (let taskId of tasksKeys) {
                let task = job.tasks.get(taskId);
                if (!jobs.includes(task.jobId)) {
                    jobs.push(task.jobId);
                }
                console.log("task", taskId, task);
                //konverze do našeho tvaru pro Redis
                let taskData = {
                    taskId: `${task.clientId}:${task.jobId}:${taskId}`,
                    jobId: task.jobId,
                    clientId: task.clientId,
                    name: taskId,
                    status: "ready",
                    global:false,
                    retryCount:0,
                    maxRetries:3,
                    timeout:10, //seconds
                    jobDone:false,
                    waitFor:null
                }

                //job má waitFor v options, takže jeho první task bude mít waitFor `${clientId}:${jobId}:$done`
                if (job.waitFor) {
                    taskData.waitFor = `${clientId}:${job.waitFor}:$done`;
                }

                if (index>0) {
                    taskData.waitFor = tasksData[index-1].taskId;
                }
                if (index==tasksKeys.length-1) {
                    taskData.jobDone = true;
                }

                index++;
                tasksData.push(taskData);

                if (taskData.waitFor) {
                    await redis.hSet("task:waiting", taskData.taskId, JSON.stringify(taskData));
                } else {
                    await redis.zAdd("task:queue", Date.now(), taskData.taskId);
                    await redis.set(`task:${taskData.taskId}`, JSON.stringify(taskData));
                }
            
            }

            let context = {
                currentTask:null,
            }
            await redis.set(`context:${clientId}:${jobId}`, JSON.stringify(context));

        }

    } else {
        console.log("client not found", clientId);
    }
}

export const newJob = (jobId, clientId, options={}) => {
    let client = getOrCreateClient(clientId);
    client.jobs.set(jobId, {...options, jobId, tasks:new Map()});
}

export const task =  (taskId, jobId, clientId, justCallbacks, fn) => {
        // registruju
        if (!justCallbacks) {
        console.log("registruju task", taskId, jobId, clientId);
        let client = getOrCreateClient(clientId);
        let job = client.jobs.get(jobId);
        job.tasks.set(taskId, {jobId, clientId, taskId});
    }
        //zaregistruju si callback pro jobId:taskId
        registerCallback(jobId, taskId, fn);
}

const processWaitingTasks = async (waitedFor) => {        //zpracuju waiting tasks
    let redis = redisLocal.getClient();
    const waitingTasks = await redis.hGetAll('task:waiting');
    for (const waitingTaskId in waitingTasks) {
        const waitingTask = JSON.parse(waitingTasks[waitingTaskId])
        if (waitingTask.waitFor === waitedFor) {
            console.log("odblokuji task", waitingTask.taskId);
            await redis.zAdd("task:queue", Date.now(), waitingTask.taskId);
            await redis.hDel("task:waiting", waitingTask.taskId);
            await redis.set(`task:${waitingTask.taskId}`, JSON.stringify(waitingTask));
        }
    }
}

const processTask = async (taskData) => {
    let redis = redisLocal.getClient();
    let fn = jobs.get(taskData.jobId);
    if (fn) {
        //vyzvednu context
        let context = await redis.get(`context:${taskData.clientId}:${taskData.jobId}`);
        context = JSON.parse(context);
        context.currentTask = taskData.taskId;

        context._postponeTask = async (seconds) => {
            await redis.zAdd("task:postponed", Date.now()+seconds*1000, taskData.taskId);
            await redis.set(`task:${taskData.taskId}:status`, 'postponed');
            await redis.set(`task:${taskData.taskId}`, JSON.stringify(taskData));
            return {_abort:true};
        }

        context._failTask = async () => {
            //stačí abort, on zhučí na timeout
            return {_abort:true};
        }

        //console.log("vyzvednu context", taskData.clientId, taskData.jobId, context);
        //najdu callback
        let callback = callbacks.get(`${taskData.jobId}:${taskData.name}`);
        if (!callback) {
            await fn(taskData.clientId, true); //jen callbacky
            callback = callbacks.get(`${taskData.jobId}:${taskData.name}`);
        }

        try {
            let result = await callback(context);
            if (typeof result === 'undefined') {
                result={}
            }
            if (typeof result._abort === 'boolean' && result._abort) {
                return;
            }
            context[taskData.name] = result;  

        } catch (error) {
            console.error(`❌ Error in task ${taskData.taskId}:`, error);
            return; //sám zhučí na timeout
        }


        //uložím context do Redis
        //console.log("new Context", context);
        await redis.set(`context:${taskData.clientId}:${taskData.jobId}`, JSON.stringify(context));

        console.log(`✅ Completing task: ${taskData.taskId}`);
        await redis.zRem("task:processing", taskData.taskId);

        //zpracuju waiting tasks
        await processWaitingTasks(taskData.taskId);

        //pokud je to poslední task z jobu, tak ho dokončím
        if (taskData.jobDone) {
            console.log(`✅ COMPLETING JOB: ${taskData.jobId}`);
            //zruším context
            await redis.del(`context:${taskData.clientId}:${taskData.jobId}`);
            //zruším všechny task:{clientId}:{jobId}:*
            console.log(`deleting keys ${taskData.clientId}:${taskData.jobId}:*`);
            for await (const key of redis.scanIterator({ MATCH: `task:${taskData.clientId}:${taskData.jobId}:*`, COUNT:100 })) {
                await redis.del(key);
            }

            //odblokuju tasky, co čekaly na doběhnutí jobu
            await processWaitingTasks(`${taskData.clientId}:${taskData.jobId}:$done`); 
        }
    }
}

export const doJob = async () => {
    let redis = await redisLocal.getClient();

    //beru z queue
    let tasks = await redis.zRange("task:queue", 0, 0);
    if (tasks.length>0) {
        let taskId = tasks[0];
        let task = await redis.zRem("task:queue", taskId);
        const taskDataJson = await redis.get(`task:${taskId}`);
        let taskData = JSON.parse(taskDataJson);
        const timeoutMs = taskData.timeout*1000;
        await redis.zAdd("task:processing", Date.now()+timeoutMs, taskId);
        taskData.status = "processing";
        await redis.set(`task:${taskId}`, JSON.stringify(taskData));
        await redis.set(`task:${taskId}:status`, 'processing');
        //console.log("do task", taskData);
        processTask(taskData); //nedělám AWAIT, protože to může být dlouhá operace
    } else {
        console.log("no tasks in queue");
    }

    //killer script
    const now = Date.now();
    const expiredTasks = await redis.zRangeByScore("task:processing", 0, now);
    for (const taskId of expiredTasks) {
        const taskDataJson = await redis.get(`task:${taskId}`);
        let taskData = JSON.parse(taskDataJson);
        await redis.zRem("task:processing", taskId);
        if (taskData.retryCount >= taskData.maxRetries) {
            console.log(`❌ Task ${taskId} exceeded max retries, marking as failed`);
            await redis.set(`task:${taskId}:status`, 'failed');
        } else {
            await redis.set(`task:${taskId}:status`, 'postponed');
            taskData.retryCount++;
            await redis.set(`task:${taskId}`, JSON.stringify(taskData));
            const retryDelay = taskData.retryCount*1000;
            await redis.zAdd("task:postponed", Date.now()+retryDelay, taskId);
        }
    }

    //postponed tasks
    const readyTasks = await redis.zRangeByScore("task:postponed", 0, now);
    for (const taskId of readyTasks) {
        await redis.zRem("task:postponed", taskId);
        await redis.set(`task:${taskId}:status`, 'ready');
        await redis.zAdd("task:queue", Date.now(), taskId);
    }


}