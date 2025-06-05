import * as scheduler from '../src/index.js';
import * as mod1 from './mod1.js';
import * as mod2 from './mod2.js';
import * as mod3 from './mod3.js';
import * as redisLocal from '@adent/redis-local';

//test... Probíhá skript, který si volá moduly

let redisURL = "redis://localhost:6379";

let redis = await redisLocal.begin({
    url: redisURL
});

//job scheduler
const doJob = async () => {
    await scheduler.doJob();
    setTimeout(doJob,1000)
}
doJob();