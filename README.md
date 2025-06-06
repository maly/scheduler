# Scheduler

Knihovna pro plánování a správu úloh (jobs) a jejich jednotlivých kroků (tasks). Systém využívá Redis pro perzistenci dat a zajišťuje spolehlivé zpracování úloh i v případě výpadku.

## Instalace

```bash
npm install @adent/scheduler
```

## Základní použití

```javascript
import * as scheduler from '@adent/scheduler';

// Inicializace scheduleru
await scheduler.begin();

// Spuštění zpracování úloh
setInterval(() => scheduler.doJob(), 1000);
```

## Dokumentace

Podrobná dokumentace včetně popisu všech funkcí a příkladů použití je k dispozici v [dokumentaci](docs/scheduler.md).

## Funkce

Knihovna poskytuje následující hlavní funkce:

- Správa úloh a jejich kroků
- Podpora globálních úloh sdílených mezi klienty
- Automatické obnovení stavu po výpadku
- Timeouty a opakované pokusy o zpracování
- Závislosti mezi kroky úlohy

## Požadavky

- Node.js 14+
- Redis server