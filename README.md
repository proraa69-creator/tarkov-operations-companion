# Tarkov Operations Companion

Локальный интерактивный прототип ПК-компаньона для Escape from Tarkov: командный центр, карты, задания, ключи, предметы и экономика.

## Запуск

Требуется Node.js 20.19 или новее.

```powershell
npm install
npm run dev
```

Для проверки production-сборки:

```powershell
npm run build
npm run preview
```

## Проверки

```powershell
npm run typecheck
npm test
npm run test:e2e
npm run lint
```

## Источники

- [Tarkov.dev GraphQL API](https://github.com/the-hideout/tarkov-api)
- [Tarkov.dev SVG Maps](https://github.com/the-hideout/tarkov-dev-svg-maps), CC BY-NC-SA 4.0
- [TarkovData](https://github.com/TarkovTracker/tarkovdata)

Приложение неофициальное и некоммерческое. Оно не читает память игры, не внедряется в игровой процесс и не автоматизирует действия. Escape from Tarkov и связанные материалы принадлежат Battlestate Games и соответствующим правообладателям.
