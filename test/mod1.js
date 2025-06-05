//testovací modul mod1
import * as scheduler from '../src/index.js';

const promisedTimeout = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const jobName = "timeline";

export const exec = (clientId, justCallbacks=false) => {

    scheduler.newJob(jobName, clientId);
    console.log("volám exec mod1", clientId);
     scheduler.task("vector", jobName, clientId, justCallbacks, async (ctx) => {
        // Volání vector search API
        //console.log("volám vector", ctx);
        let vectorResults = {fake:"dataE"}
        await promisedTimeout(1000);
        if (Math.random()<0.2) {
            throw new Error("test error");
        }
        return vectorResults;
      });
      
      scheduler.task("generate", jobName, clientId, justCallbacks, async (ctx) => {
        // Použij ctx.vector výsledky, volej LLM
        //console.log("volám generate", ctx);
        let timelineData = {fake:"dataG"}
        await promisedTimeout(3000);
        return timelineData;
      });
      
      scheduler.task("verify", jobName, clientId, justCallbacks, async (ctx) => {
        // Ověř ctx.generate výsledky
        //console.log("volám verify", ctx);
        let verifiedTimeline = {fake:"dataV"}
        await promisedTimeout(4000);
        return verifiedTimeline;
      });

      scheduler.task("done", jobName, clientId, justCallbacks, async (ctx) => {
        console.log(`job ${jobName} done`, JSON.stringify(ctx));
        
      });
    }

scheduler.registerJob(jobName, exec);

