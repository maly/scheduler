import * as redisLocal from "@adent/redis-local";

const GLOBAL="-global"

let clients = new Map();

let jobs = new Map();

let callbacks = new Map();

const registerCallback = (jobId, taskId, fn) => {
    callbacks.set(`${jobId}:${taskId}`, fn);
}

export const registerJob = (jobId, fn) => {
    jobs.set(jobId, fn);
}

export const registerGlobalJob = (fn) => {
    jobs.set(GLOBAL, fn);
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
                    waitFor:[]
                }

                //job má waitFor v options, takže jeho první task bude mít waitFor `${clientId}:${jobId}:$done`
                if (job.waitFor) {
                    taskData.waitFor.push(`${clientId}:${job.waitFor}:$done`);
                }

                if (index>0) {
                    taskData.waitFor.push(tasksData[index-1].taskId);
                }
                if (index==tasksKeys.length-1) {
                    taskData.jobDone = true;
                }

                //options přebíjí to, co je v taskData. Vezmu klíče a dám je tam
                for (const key in task.options) {
                    if (key=="waitFor") {
                        //musím je obohatit na fully qualified name
                        taskData.waitFor = task.options[key].map(item => `${clientId}:${jobId}:${item}`);
                    } else {
                        taskData[key] = task.options[key];
                    }
                    
                }

                index++;
                tasksData.push(taskData);

                if (taskData.waitFor.length>0) {
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

        //vytvořím "order:$clientId", kde budou všechny joby v objednávce jako pole názvů: ["clientId:job1", "clientId:job2", ...]
        let order = jobs.map(job => `${clientId}:${job}`);
        await redis.set(`order:${clientId}`, JSON.stringify(order));

    } else {
        console.log("client not found", clientId);
    }
}

export const newJob = (jobId, clientId, options={}) => {
    let client = getOrCreateClient(clientId);
    client.jobs.set(jobId, {...options, jobId, tasks:new Map()});
}

export const newGlobalJob = (clientId) => {
    newJob(GLOBAL, clientId);
}

export const task =  (taskId, jobId, clientId, justCallbacks, fn, options={}) => {
        // registruju
        if (!justCallbacks) {
        console.log("registruju task", taskId, jobId, clientId);
        let client = getOrCreateClient(clientId);
        let job = client.jobs.get(jobId);
        job.tasks.set(taskId, {jobId, clientId, taskId, options});
    }
        //zaregistruju si callback pro jobId:taskId
        registerCallback(jobId, taskId, fn);
}

export const globalTask = (taskId, clientId, justCallbacks, fn, options={}) => {
    task(taskId, GLOBAL, clientId, justCallbacks, fn, {...options, waitFor:["$"]});
}

// ===============================
// Po recovery
// ===============================

export const begin = async () => {
    let redis = await redisLocal.getClient();
    //všechny, co jsou processing, musím vrátit z processing do queue
    const processingTasks = await redis.zRange("task:processing", 0, -1);
    for (const taskId of processingTasks) {
        await redis.zRem("task:processing", taskId);
        await redis.zAdd("task:queue", Date.now(), taskId);
        const taskDataJson = await redis.get(`task:${taskId}`);
        let taskData = JSON.parse(taskDataJson);
        taskData.status = "ready";
        await redis.set(`task:${taskId}`, JSON.stringify(taskData));
    }

}

// ===============================
// SCHEDULER
// ===============================

const processWaitingTasks = async (waitedFor) => {        //zpracuju waiting tasks
    let redis = redisLocal.getClient();
    const waitingTasks = await redis.hGetAll('task:waiting');
    for (const waitingTaskId in waitingTasks) {
        const waitingTask = JSON.parse(waitingTasks[waitingTaskId])


        //pokud je v poli waitFor waitedFor a pole má víc než jeden prvek, tak ho smažu z pole, uložím a pokračuju.
        if (waitingTask.waitFor.includes(waitedFor) && waitingTask.waitFor.length>1) {
            waitingTask.waitFor = waitingTask.waitFor.filter(item => item !== waitedFor);
            //await redis.set(`task:${waitingTask.taskId}`, JSON.stringify(waitingTask));
            //potřebuju to zapsat do task:waiting:taskId
            await redis.hSet("task:waiting", waitingTask.taskId, JSON.stringify(waitingTask));
            continue;
        }

        //pokud je waitFor pole, tak najdu, jestli tam je waitedFor
        if (waitingTask.waitFor.length==1 && waitingTask.waitFor[0] === waitedFor) {
            waitingTask.waitFor = [];
            console.log("odblokuji task", waitingTask.taskId);
            await redis.zAdd("task:queue", Date.now(), waitingTask.taskId);
            await redis.hDel("task:waiting", waitingTask.taskId);
            await redis.set(`task:${waitingTask.taskId}`, JSON.stringify(waitingTask));
        }
    }
}

const jobDone = async (taskData, forceGlobalStop=false) => {
    if (taskData.jobId==GLOBAL && !forceGlobalStop) {
        return;
    }
    let redis = redisLocal.getClient();
    console.log(`✅ COMPLETING JOB: ${taskData.jobId}`);
    //zruším context
    await redis.del(`context:${taskData.clientId}:${taskData.jobId}`);
    //zruším všechny task:{clientId}:{jobId}:*
    console.log(`deleting keys ${taskData.clientId}:${taskData.jobId}:*`);
    for await (const key of redis.scanIterator({ MATCH: `task:${taskData.clientId}:${taskData.jobId}:*`, COUNT:100 })) {
        console.log("deleting key", key);
        await redis.del(key);
    }

    //odblokuju tasky, co čekaly na doběhnutí jobu
    await processWaitingTasks(`${taskData.clientId}:${taskData.jobId}:$done`); 

    //podívám se do objednávky pro klienta a odstraním z něj doběhnutý job
    let order = await redis.get(`order:${taskData.clientId}`);
    order = JSON.parse(order);
    order = order.filter(job => job !== `${taskData.clientId}:${taskData.jobId}`);
    //je možné, že zůstal už jen jediný prvek. Pokud to je "clientId:$global", tak je to už nepotřebný global a můžu ho smazat
    console.log("order", order);
    if (order.length>0) {
        await redis.set(`order:${taskData.clientId}`, JSON.stringify(order));
    }
    if (order.length==1 && order[0] === `${taskData.clientId}:${GLOBAL}`) {
        return jobDone({clientId:taskData.clientId, jobId:GLOBAL}, true);
    } 

    if (order.length==0 ) {
        await redis.del(`order:${taskData.clientId}`);
    }

    return true;
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

        context._getGlobalData = async (globalTaskId) => {
            let result = await redis.get(`task:${taskData.clientId}:${GLOBAL}:${globalTaskId}:result`);
            if (result) {
                return JSON.parse(result);
            } else {
                //nejsou data, takže:
                //1. současný task přesunu z processing do waiting, s waitFor: [${taskData.clientId}:$global:${taskId}]
                taskData.waitFor.push(`${taskData.clientId}:${GLOBAL}:${globalTaskId}`);
                await redis.hSet("task:waiting", taskData.taskId, JSON.stringify(taskData));
                await redis.zRem("task:processing", taskData.taskId);
                //2. vyzvednu si globální task z waiting
                let globalTask = await redis.hGet("task:waiting", `${taskData.clientId}:${GLOBAL}:${globalTaskId}`);
                //pokud tam není, tak to už se asi procesuje. Takže zdechung.
                if (!globalTask) {
                    console.log("global task not found", `${taskData.clientId}:${GLOBAL}:${globalTaskId}`);
                    return null;
                }
                globalTask = JSON.parse(globalTask);
                console.log("global task found", globalTask);
                globalTask.waitFor = [];
                globalTask.status = "ready";
                await redis.hDel("task:waiting", `${taskData.clientId}:${GLOBAL}:${globalTaskId}`);
                //3. přesunu globální task do queue s časem = 0
                await redis.zAdd("task:queue", 1, `${taskData.clientId}:${GLOBAL}:${globalTaskId}`);
                await redis.set(`task:${taskData.clientId}:${GLOBAL}:${globalTaskId}`, JSON.stringify(globalTask));
                //4. Vracím se zpět s null
                return null;
            }
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
            if (result===null) {
                return; //nic se neukládá, nic se nenastavuje, jen se mizí
            }
            if (typeof result._abort === 'boolean' && result._abort) {
                return;
            }
            context[taskData.name] = result;  

            //uložím result do set task:$clientId:$jobId:$taskId:result
            await redis.set(`task:${taskData.clientId}:${taskData.jobId}:${taskData.name}:result`, JSON.stringify(result));

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
            await jobDone(taskData);
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
        if (!taskData) {
            console.log("task not found", taskId);
            return;
        }
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