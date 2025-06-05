//testovací modul mod1
import * as scheduler from '../src/index.js';

const promisedTimeout = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const jobName = "keyFactsFollow"; //tento job se spustí až po dokončení jobu keyFacts

export const exec = (clientId, justCallbacks=false) => {

    scheduler.newJob(jobName, clientId, {waitFor:"keyFacts"});
    console.log("volám exec",jobName, clientId);
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

      scheduler.task("articles", jobName, clientId, justCallbacks, async (ctx) => {
        // Použij ctx.vector výsledky, volej LLM
        //console.log("volám generate", ctx);
        let timelineData = {fake:"articles"}
        await promisedTimeout(726);
        return timelineData;
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

