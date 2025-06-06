//testovací modul mod1
import * as scheduler from '../src/index.js';

const promisedTimeout = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export const exec = (clientId, justCallbacks=false) => {

    scheduler.newGlobalJob(clientId);
    console.log("volám exec global", clientId);

      scheduler.globalTask("getArticles", clientId, justCallbacks, async (ctx) => {
        // Ověř ctx.generate výsledky
        //console.log("volám verify", ctx);
        let articles = {article1:"dataArticles1", article2:"dataArticles2"}
        await promisedTimeout(4000);
        return articles;
      });

    }

scheduler.registerGlobalJob(exec);

