# Dokumentace knihovny Scheduler

Tato knihovna poskytuje systém pro správu objednávek, které se skládají z úloh (jobs) a jejich jednotlivých kroků (tasks). Systém využívá Redis pro perzistenci dat a zajišťuje spolehlivé zpracování i v případě výpadku.

## Hierarchie systému

1. **Objednávka (Order)**
   - Reprezentuje kompletní požadavek klienta
   - Obsahuje jednu nebo více úloh
   - Je identifikována pomocí `clientId`

2. **Úloha (Job)**
   - Je součástí objednávky
   - Obsahuje jeden nebo více úkolů
   - Úkoly jsou zpravidla prováděny sekvenčně
   - Je identifikována pomocí `jobId`

3. **Úkol (Task)**
   - Je součástí úlohy
   - Může mít závislosti na jiných úkolech
   - Ve výchozím stavu čeká na dokončení předchozího úkolu
   - Je identifikován pomocí `taskId`

## Exportované funkce

### `registerJob(jobId, fn)`
Registruje novou úlohu do systému.

**Parametry:**
- `jobId` (string) - Unikátní identifikátor úlohy
- `fn` (function) - Callback funkce, která bude volána při zpracování úlohy

### `registerGlobalJob(fn)`
Registruje globální úlohu, která může být sdílena mezi více klienty.

**Parametry:**
- `fn` (function) - Callback funkce pro globální úlohu

### `finishClient(clientId)`
Dokončí všechny úlohy v objednávce pro daného klienta a vyčistí související data.

**Parametry:**
- `clientId` (string) - Identifikátor klienta

### `newJob(jobId, clientId, options)`
Vytvoří novou úlohu v objednávce pro konkrétního klienta.

**Parametry:**
- `jobId` (string) - Identifikátor úlohy
- `clientId` (string) - Identifikátor klienta
- `options` (object) - Volitelné nastavení úlohy (výchozí hodnota: {})

### `newGlobalJob(clientId)`
Vytvoří novou globální úlohu v objednávce pro klienta.

**Parametry:**
- `clientId` (string) - Identifikátor klienta

### `task(taskId, jobId, clientId, justCallbacks, fn, options)`
Registruje nový úkol v rámci úlohy.

**Parametry:**
- `taskId` (string) - Identifikátor úkolu
- `jobId` (string) - Identifikátor úlohy
- `clientId` (string) - Identifikátor klienta
- `justCallbacks` (boolean) - Pokud true, pouze registruje callback bez vytváření úkolu
- `fn` (function) - Callback funkce pro zpracování úkolu
- `options` (object) - Volitelné nastavení úkolu (výchozí hodnota: {})

### `globalTask(taskId, clientId, justCallbacks, fn, options)`
Registruje nový úkol v rámci globální úlohy.

**Parametry:**
- `taskId` (string) - Identifikátor úkolu
- `clientId` (string) - Identifikátor klienta
- `justCallbacks` (boolean) - Pokud true, pouze registruje callback bez vytváření úkolu
- `fn` (function) - Callback funkce pro zpracování úkolu
- `options` (object) - Volitelné nastavení úkolu (výchozí hodnota: {})

### `begin()`
Inicializuje scheduler a obnoví stav z Redis. Tato funkce by měla být volána při startu aplikace.

### `doJob()`
Zpracovává frontu úkolů. Tato funkce by měla být volána pravidelně pro zpracování čekajících úkolů.

## Kontext úlohy

Při zpracování úkolu je k dispozici kontext s následujícími vlastnostmi:

- `currentTask` - Identifikátor aktuálně zpracovávaného úkolu
- `_postponeTask(seconds)` - Funkce pro odložení zpracování úkolu
- `_failTask()` - Funkce pro označení úkolu jako neúspěšného
- `_getGlobalData(globalTaskId)` - Funkce pro získání dat z globální úlohy

Kontext obsahuje také data ze všech již proběhlých úkolů v rámci stejné úlohy. Tato data jsou dostupná jako objekty s klíčem odpovídajícím názvu úkolu. Například pokud úkol "vector" vrátil data `{fake: "dataE"}`, budou tato data dostupná v kontextu jako `ctx.vector.fake`.

Každý úkol musí vrátit svá data (jako objekt), která budou uložena do kontextu pod klíčem odpovídajícím názvu úkolu. Pokud úkol vrátí `null`, je úkol považován za nezpracovaný a je ukončen. Když úkol nevrátí nic (return;), bere se to jako prázdný objekt {}

## Nastavení úlohy (options)

Úloha může mít následující nastavení:

- `waitFor` (string) - Identifikátor úlohy, na kterou tato úloha čeká. Úloha se spustí až po dokončení specifikované úlohy.

## Nastavení úkolu (options)

Úkol může mít následující nastavení:

- `waitFor` (array) - Seznam úkolů, na které tento úkol čeká. Pokud není specifikováno, úkol čeká na dokončení předchozího úkolu v rámci stejné úlohy.
- `retryCount` (number) - Počet pokusů o zpracování (výchozí: 0)
- `maxRetries` (number) - Maximální počet pokusů (výchozí: 3)
- `timeout` (number) - Timeout v sekundách (výchozí: 10)
- `global` (boolean) - Zda je úkol globální (výchozí: false)

## Příklady použití

### Příklad úlohy čekající na jinou úlohu

```javascript
import * as scheduler from './scheduler';

const jobName = "keyFactsFollow"; // Tato úloha se spustí až po dokončení úlohy keyFacts

// Registrace úlohy
scheduler.registerJob(jobName, (clientId, justCallbacks) => {
    // Vytvoření nové instance úlohy pro klienta s čekáním na úlohu keyFacts
    scheduler.newJob(jobName, clientId, {waitFor: "keyFacts"});

    // Registrace jednotlivých úkolů
    scheduler.task("vector", jobName, clientId, justCallbacks, async (ctx) => {
        let vectorResults = {fake: "dataE"};
        await promisedTimeout(1000);
        return vectorResults;
    });

    scheduler.task("articles", jobName, clientId, justCallbacks, async (ctx) => {
        // Použití výsledků z předchozího úkolu
        console.log("Výsledky z vector úkolu:", ctx.vector);
        let timelineData = {fake: "articles"};
        await promisedTimeout(726);
        return timelineData;
    });

    scheduler.task("generate", jobName, clientId, justCallbacks, async (ctx) => {
        // Použití výsledků z předchozích úkolů
        console.log("Výsledky z vector úkolu:", ctx.vector);
        console.log("Výsledky z articles úkolu:", ctx.articles);
        let timelineData = {fake: "dataG"};
        await promisedTimeout(3000);
        return timelineData;
    });

    scheduler.task("verify", jobName, clientId, justCallbacks, async (ctx) => {
        // Ověření výsledků z předchozích úkolů
        console.log("Výsledky z generate úkolu:", ctx.generate);
        let verifiedTimeline = {fake: "dataV"};
        await promisedTimeout(4000);
        return verifiedTimeline;
    });

    scheduler.task("done", jobName, clientId, justCallbacks, async (ctx) => {
        // Výpis všech výsledků z úlohy
        console.log(`Úloha ${jobName} dokončena`, JSON.stringify(ctx));
    });
});
```

### Příklad běžné úlohy

```javascript
import * as scheduler from './scheduler';

const jobName = "timeline";

// Registrace úlohy
scheduler.registerJob(jobName, (clientId, justCallbacks) => {
    // Vytvoření nové instance úlohy pro klienta
    scheduler.newJob(jobName, clientId);

    // Registrace jednotlivých úkolů
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
    }, { waitFor: [] }); // Tento úkol nečeká na žádný předchozí

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
    }, { waitFor: ["vector", "parallel"] }); // Tento úkol čeká na dokončení úkolů "vector" a "parallel"

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

    // Registrace globálního úkolu
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

## Spouštění objednávky a task managementu

### Spuštění objednávky

Pro spuštění objednávky je potřeba:

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
    
    // Dokončení všech úloh v objednávce pro klienta
    await scheduler.finishClient(clientId);
}

main();
```

### Task Management

Pro zpracování úkolů je potřeba spustit task management:

```javascript
const doJob = async () => {
    await scheduler.doJob();
    setTimeout(doJob, 1000); // Opakované volání každou sekundu
}
doJob();
```

Scheduler automaticky spravuje:
- Frontu čekajících úkolů
- Zpracovávané úkoly
- Odložené úkoly
- Timeouty a opakované pokusy
- Závislosti mezi úkoly

Pro správné fungování je důležité:
1. Importovat všechny moduly obsahující definice úloh před spuštěním task managementu
2. Pravidelně volat `doJob()` pro zpracování fronty
3. Správně nastavit timeouty a počty opakování v options
4. Definovat závislosti mezi úkoly pomocí `waitFor`
5. Ošetřit chybové stavy pomocí `_failTask()` nebo `_postponeTask()`

Poznámka: Import modulů není nutný, pokud jsou definice úloh součástí stejného skriptu jako generování objednávky. 