# Dokumentace knihovny Scheduler

Tato knihovna poskytuje systém pro plánování a správu úloh (jobs) a jejich jednotlivých kroků (tasks). Systém využívá Redis pro perzistenci dat a zajišťuje spolehlivé zpracování úloh i v případě výpadku.

## Exportované funkce

### `registerJob(jobId, fn)`
Registruje novou úlohu (job) do systému.

**Parametry:**
- `jobId` (string) - Unikátní identifikátor úlohy
- `fn` (function) - Callback funkce, která bude volána při zpracování úlohy

### `registerGlobalJob(fn)`
Registruje globální úlohu, která může být sdílena mezi více klienty.

**Parametry:**
- `fn` (function) - Callback funkce pro globální úlohu

### `finishClient(clientId)`
Dokončí všechny úlohy pro daného klienta a vyčistí související data.

**Parametry:**
- `clientId` (string) - Identifikátor klienta

### `newJob(jobId, clientId, options)`
Vytvoří novou úlohu pro konkrétního klienta.

**Parametry:**
- `jobId` (string) - Identifikátor úlohy
- `clientId` (string) - Identifikátor klienta
- `options` (object) - Volitelné nastavení úlohy (výchozí hodnota: {})

### `newGlobalJob(clientId)`
Vytvoří novou globální úlohu pro klienta.

**Parametry:**
- `clientId` (string) - Identifikátor klienta

### `task(taskId, jobId, clientId, justCallbacks, fn, options)`
Registruje nový krok (task) v rámci úlohy.

**Parametry:**
- `taskId` (string) - Identifikátor kroku
- `jobId` (string) - Identifikátor úlohy
- `clientId` (string) - Identifikátor klienta
- `justCallbacks` (boolean) - Pokud true, pouze registruje callback bez vytváření tasku
- `fn` (function) - Callback funkce pro zpracování kroku
- `options` (object) - Volitelné nastavení kroku (výchozí hodnota: {})

### `globalTask(taskId, clientId, justCallbacks, fn, options)`
Registruje nový krok v rámci globální úlohy.

**Parametry:**
- `taskId` (string) - Identifikátor kroku
- `clientId` (string) - Identifikátor klienta
- `justCallbacks` (boolean) - Pokud true, pouze registruje callback bez vytváření tasku
- `fn` (function) - Callback funkce pro zpracování kroku
- `options` (object) - Volitelné nastavení kroku (výchozí hodnota: {})

### `begin()`
Inicializuje scheduler a obnoví stav z Redis. Tato funkce by měla být volána při startu aplikace.

### `doJob()`
Zpracovává frontu úloh. Tato funkce by měla být volána pravidelně pro zpracování čekajících úloh.

## Kontext úlohy

Při zpracování kroku je k dispozici kontext s následujícími vlastnostmi:

- `currentTask` - Identifikátor aktuálně zpracovávaného kroku
- `_postponeTask(seconds)` - Funkce pro odložení zpracování kroku
- `_failTask()` - Funkce pro označení kroku jako neúspěšného
- `_getGlobalData(globalTaskId)` - Funkce pro získání dat z globální úlohy

## Nastavení kroku (options)

Krok může mít následující nastavení:

- `waitFor` (array) - Seznam kroků, na které tento krok čeká
- `retryCount` (number) - Počet pokusů o zpracování (výchozí: 0)
- `maxRetries` (number) - Maximální počet pokusů (výchozí: 3)
- `timeout` (number) - Timeout v sekundách (výchozí: 10)
- `global` (boolean) - Zda je krok globální (výchozí: false)

## Příklady použití

### Příklad běžné úlohy

```javascript
import * as scheduler from './scheduler';

const jobName = "timeline";

// Registrace úlohy
scheduler.registerJob(jobName, (clientId, justCallbacks) => {
    // Vytvoření nové instance úlohy pro klienta
    scheduler.newJob(jobName, clientId);

    // Registrace jednotlivých kroků
    scheduler.task("vector", jobName, clientId, justCallbacks, async (ctx) => {
        // Zpracování vektoru
        let vectorResults = { fake: "dataE" };
        await promisedTimeout(1000);
        return vectorResults;
    });

    scheduler.task("parallel", jobName, clientId, justCallbacks, async (ctx) => {
        // Paralelní zpracování
        let timelineData = { fake: "dataP" };
        await promisedTimeout(3000);
        return timelineData;
    }, { waitFor: [] });

    scheduler.task("generate", jobName, clientId, justCallbacks, async (ctx) => {
        // Získání dat z globální úlohy
        let articles = await ctx._getGlobalData("getArticles");
        if (!articles) return null;

        // Generování výsledků
        let timelineData = {
            fake: ctx.vector.fake + ctx.parallel.fake + "{" + Object.values(articles).join(",") + "}"
        };
        await promisedTimeout(3000);
        return timelineData;
    }, { waitFor: ["vector", "parallel"] });

    scheduler.task("verify", jobName, clientId, justCallbacks, async (ctx) => {
        // Ověření výsledků
        let verifiedTimeline = { fake: "dataVerified:" + ctx.generate.fake };
        await promisedTimeout(4000);
        return verifiedTimeline;
    });

    scheduler.task("done", jobName, clientId, justCallbacks, async (ctx) => {
        console.log(`job ${jobName} done`, JSON.stringify(ctx));
    });
});
```

### Příklad globální úlohy

```javascript
import * as scheduler from './scheduler';

// Registrace globální úlohy
scheduler.registerGlobalJob((clientId, justCallbacks) => {
    // Vytvoření nové instance globální úlohy pro klienta
    scheduler.newGlobalJob(clientId);

    // Registrace globálního kroku
    scheduler.globalTask("getArticles", clientId, justCallbacks, async (ctx) => {
        // Zpracování článků
        let articles = {
            article1: "dataArticles1",
            article2: "dataArticles2"
        };
        await promisedTimeout(4000);
        return articles;
    });
});
```

V těchto příkladech vidíte:
1. Jak registrovat běžnou úlohu s více kroky
2. Jak používat závislosti mezi kroky pomocí `waitFor`
3. Jak získávat data z globální úlohy pomocí `_getGlobalData`
4. Jak vytvořit a registrovat globální úlohu
5. Jak pracovat s kontextem a vracet výsledky z jednotlivých kroků 

## Spouštění client jobu a task managementu

### Spuštění client jobu

Pro spuštění client jobu je potřeba:

1. Inicializovat Redis klienta:
```javascript
import * as redisLocal from '@adent/redis-local';

const redisURL = "redis://localhost:6379";
const redis = await redisLocal.begin({
    url: redisURL
});
```

2. Inicializovat scheduler:
```javascript
import * as scheduler from './scheduler';

await scheduler.begin();
```

3. Importovat všechny moduly obsahující definice úloh:
```javascript
import * as mod1 from './mod1.js';
import * as mod2 from './mod2.js';
import * as mod3 from './mod3.js';
import * as global from './global.js';
```

4. Spustit zpracování úloh pro klienta:
```javascript
const main = async () => {
    const clientId = "123";
    
    // Spuštění jednotlivých modulů s úlohami
    mod1.exec(clientId);
    mod2.exec(clientId);
    mod3.exec(clientId);
    global.exec(clientId);
    
    // Dokončení všech úloh pro klienta
    await scheduler.finishClient(clientId);
}

main();
```

### Task Management

Pro zpracování úloh je potřeba spustit task management:

```javascript
const doJob = async () => {
    await scheduler.doJob();
    setTimeout(doJob, 1000); // Opakované volání každou sekundu
}
doJob();
```

Scheduler automaticky spravuje:
- Frontu čekajících úloh
- Zpracovávané úlohy
- Odložené úlohy
- Timeouty a opakované pokusy
- Závislosti mezi úlohami

Pro správné fungování je důležité:
1. Importovat všechny moduly obsahující definice úloh před spuštěním task managementu
2. Pravidelně volat `doJob()` pro zpracování fronty
3. Správně nastavit timeouty a počty opakování v options
4. Definovat závislosti mezi úlohami pomocí `waitFor`
5. Ošetřit chybové stavy pomocí `_failTask()` nebo `_postponeTask()`

Poznámka: Import modulů není nutný, pokud jsou definice úloh součástí stejného skriptu jako generování client jobu. 