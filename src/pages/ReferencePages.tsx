import { uiText } from '../i18n/renderText'
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TraderQuestBoard } from "../components/TraderQuestBoard";
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  Crosshair,
  Database,
  HardDrive,
  KeyRound,
  Minus,
  Plus,
  Search,
} from "lucide-react";
import { useTarkovData } from "../data/DataProvider";
import { useAppState } from "../state/AppState";
import { formatPrice, timeAgo } from "../shared/format";
import { useLocale } from "../i18n/LocaleProvider";
import { setRaidSmokeEnabled, useRaidSmokeEnabled } from "../app/raidSmokeSetting";
import { RaidSmokeSettings } from "../components/RaidSmokeSettings";
import { ServerAddressPanel } from "../mobile/ServerAddressPanel";
import { ServerAccountPanel } from "../components/ServerAccountPanel";
import { usesWebAccount } from "../sync/serverSync";

export function EconomyPage() {
  const { data, source, updatedAt } = useTarkovData();
  const state = useAppState();
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () =>
      data.items
        .flatMap((item) => {
          const quotes = item.prices.filter(
            (quote) => quote.mode === state.raidMode,
          );
          const best = quotes.slice().sort((a, b) => b.price - a.price)[0];
          return best
            ? [
                {
                  item,
                  best,
                  spread:
                    best.price -
                    Math.min(...quotes.map((quote) => quote.price)),
                },
              ]
            : [];
        })
        .filter(({ item }) =>
          `${item.name} ${item.shortName}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .sort((a, b) => b.best.price - a.best.price),
    [data.items, query, state.raidMode],
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText(" Рыночная разведка · ")}{uiText(state.raidMode.toUpperCase())}
          </div>
          <h1 className="page-title">{uiText("Экономика")}</h1>
          <p className="page-subtitle">{uiText(" Сравнение источников продажи. Все цены показывают режим и время последнего обновления. ")}</p>
        </div>
        <span className={`tag ${source === "demo" ? "danger" : "green"}`}>
          <Database size={12} />{uiText(" ")}
          {uiText(source === "demo" ? "демо-цены" : `обновлено ${timeAgo(updatedAt)}`)}
        </span>
      </header>
      {uiText(source === "demo" && (
        <div
          className="panel"
          style={{
            padding: 14,
            marginBottom: 14,
            borderColor: "#5c4630",
            color: "#d3b485",
          }}
        >
          <AlertTriangle
            size={16}
            style={{ verticalAlign: "middle", marginRight: 8 }}
          />{uiText(" Tarkov.dev временно недоступен. Показаны встроенные демонстрационные значения — не используйте их для точного расчёта сделки. ")}</div>
      ))}
      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">{uiText("Рейтинг ценности")}</div>
          <div style={{ position: "relative" }}>
            <Search
              size={14}
              style={{
                position: "absolute",
                left: 11,
                top: 11,
                color: "var(--text-dim)",
              }}
            />
            <input
              className="input"
              style={{ height: 35, paddingLeft: 32 }}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={uiText("Найти предмет…")}
            />
          </div>
        </div>
        <div className="panel-body" style={{ overflowX: "auto" }}>
          <table className="price-table">
            <thead>
              <tr>
                <th>{uiText("Предмет")}</th>
                <th>{uiText("Категория")}</th>
                <th>{uiText("Лучший источник")}</th>
                <th>{uiText("Разница")}</th>
                <th>{uiText("Цена")}</th>
              </tr>
            </thead>
            <tbody>
              {uiText(rows.map(({ item, best, spread }) => (
                <tr key={item.id}>
                  <td>
                    <Link
                      to={`/flea?selected=${item.id}`}
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <img className="item-thumb" src={item.iconUrl} alt={uiText("")} />
                      <span>
                        <strong>{uiText(item.name)}</strong>
                        <small className="dim" style={{ display: "block" }}>
                          {uiText(item.shortName)}
                        </small>
                      </span>
                    </Link>
                  </td>
                  <td>
                    <span className="tag">{uiText(item.category)}</span>
                  </td>
                  <td>{uiText(best.source)}</td>
                  <td className="mono price-up">+{uiText(formatPrice(spread))}</td>
                  <td className="mono">
                    <strong>{uiText(formatPrice(best.price))}</strong>
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function KeysPage() {
  const { data } = useTarkovData();
  const state = useAppState();
  const [query, setQuery] = useState("");
  const keys = data.items.filter(
    (item) =>
      item.category === "Ключ" &&
      item.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText("Доступ и маршруты")}</div>
          <h1 className="page-title">{uiText("Ключи")}</h1>
          <p className="page-subtitle">{uiText(" Где применяется ключ, какое задание открывает и сколько он стоит. ")}</p>
        </div>
        <span className="tag brass">
          <KeyRound size={12} /> {uiText(keys.length)}{uiText(" ключей ")}</span>
      </header>
      <div className="filter-row">
        <div style={{ position: "relative" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 12,
              top: 13,
              color: "var(--text-dim)",
            }}
          />
          <input
            className="input"
            style={{ paddingLeft: 34 }}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={uiText("Номер комнаты или название…")}
          />
        </div>
      </div>
      <div className="grid-3">
        {uiText(keys.map((item) => {
          const map = data.maps.find((entry) => entry.id === item.mapId);
          const quests =
            item.questIds
              ?.map((id) => data.quests.find((entry) => entry.id === id))
              .filter(Boolean) ?? [];
          const price = item.prices
            .filter((p) => p.mode === state.raidMode)
            .sort((a, b) => b.price - a.price)[0];
          return (
            <article className="panel" key={item.id}>
              <div className="item-detail-visual" style={{ minHeight: 140 }}>
                <img
                  src={item.iconUrl}
                  alt={uiText(item.name)}
                  style={{ maxHeight: 90 }}
                />
              </div>
              <div className="panel-body">
                <div className="eyebrow">{uiText(map?.name ?? "Разные локации")}</div>
                <h3 style={{ margin: "9px 0 7px" }}>{uiText(item.name)}</h3>
                <p className="muted" style={{ minHeight: 58, lineHeight: 1.5 }}>
                  {uiText(item.description)}
                </p>
                <div className="filter-row">
                  {uiText(quests.map(
                    (quest) =>
                      quest && (
                        <span className="tag brass" key={quest.id}>
                          {uiText(quest.name)}
                        </span>
                      ),
                  ))}
                </div>
                <div className="divider" />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingTop: 13,
                  }}
                >
                  <strong className="mono price-up">
                    {uiText(price ? formatPrice(price.price) : "—")}
                  </strong>
                  <Link
                    className="button small"
                    to={`/flea?selected=${item.id}`}
                  >{uiText(" Подробнее ")}<ArrowUpRight size={13} />
                  </Link>
                </div>
              </div>
            </article>
          );
        }))}
      </div>
    </div>
  );
}

export function AmmoPage() {
  const { data } = useTarkovData();
  const state = useAppState();
  const [caliber, setCaliber] = useState("Все калибры");
  const ammo = data.items.filter((item) => item.category === "Боеприпас");
  const calibers = [
    "Все калибры",
    ...new Set(ammo.map((item) => item.caliber).filter(Boolean)),
  ];
  const filtered = ammo
    .filter((item) => caliber === "Все калибры" || item.caliber === caliber)
    .sort((a, b) => (b.penetration ?? 0) - (a.penetration ?? 0));
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText("Баллистика")}</div>
          <h1 className="page-title">{uiText("Боеприпасы")}</h1>
          <p className="page-subtitle">{uiText(" Сравнение урона, пробития и цены для быстрой подготовки боекомплекта. ")}</p>
        </div>
        <span className="tag green">
          <Crosshair size={12} />{uiText(" сортировка по пробитию ")}</span>
      </header>
      <div className="filter-row">
        <select
          className="select"
          value={caliber}
          onChange={(event) => setCaliber(event.target.value)}
        >
          {uiText(calibers.map((entry) => (
            <option key={entry}>{uiText(entry)}</option>
          )))}
        </select>
      </div>
      <section className="panel">
        <div className="panel-body" style={{ overflowX: "auto" }}>
          <table className="price-table">
            <thead>
              <tr>
                <th>{uiText("Патрон")}</th>
                <th>{uiText("Калибр")}</th>
                <th>{uiText("Урон")}</th>
                <th>{uiText("Пробитие")}</th>
                <th>{uiText("Против брони")}</th>
                <th>{uiText("Цена")}</th>
              </tr>
            </thead>
            <tbody>
              {uiText(filtered.map((item) => {
                const price = item.prices.find(
                  (quote) => quote.mode === state.raidMode,
                );
                const effectiveClass = Math.min(
                  6,
                  Math.max(1, Math.floor((item.penetration ?? 0) / 8)),
                );
                return (
                  <tr key={item.id}>
                    <td>
                      <Link
                        to={`/flea?selected=${item.id}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <img className="item-thumb" src={item.iconUrl} alt={uiText("")} />
                        <strong>{uiText(item.shortName)}</strong>
                      </Link>
                    </td>
                    <td>{uiText(item.caliber)}</td>
                    <td className="mono">{uiText(item.damage)}</td>
                    <td>
                      <strong className="mono">{uiText(item.penetration)}</strong>
                      <div
                        className="priority-bar"
                        style={{ width: 110, marginTop: 6 }}
                      >
                        <span
                          style={{
                            width: `${Math.min(100, (item.penetration ?? 0) * 1.6)}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      <span className="tag brass">{uiText(" до класса ")}{uiText(effectiveClass)}
                      </span>
                    </td>
                    <td className="mono">
                      {uiText(price ? formatPrice(price.price) : "—")}
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function HideoutPage() {
  const { data } = useTarkovData();
  const state = useAppState();
  const [selectedId, setSelectedId] = useState(data.hideout[0]?.id ?? "");
  const selected =
    data.hideout.find((station) => station.id === selectedId) ??
    data.hideout[0];
  const currentLevel = selected
    ? (state.activeProfile.modes[state.raidMode].hideoutLevels[selected.id] ??
      0)
    : 0;
  const next = selected?.levels?.find(
    (level) => level.level === currentLevel + 1,
  );
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText(" Инфраструктура · ")}{uiText(state.raidMode.toUpperCase())}
          </div>
          <h1 className="page-title">{uiText("Убежище")}</h1>
          <p className="page-subtitle">{uiText(" Схематический вид сверху: модули, уровни и требования к постройке. Уровни пока указываются вручную — в журналах EFT нет надёжного снимка убежища. ")}</p>
        </div>
        <span className="tag brass">
          <Boxes size={12} /> {uiText(data.hideout.length)}{uiText(" модулей ")}</span>
      </header>
      <div className="hideout-layout">
        <section className="panel hideout-map" aria-label={uiText("Схема убежища")}>
          <div className="hideout-schematic">
            <div className="hideout-corridor" aria-hidden="true">{uiText("ВХОД ↓")}</div>
            {uiText(data.hideout.map((station, index) => {
              const level =
                state.activeProfile.modes[state.raidMode].hideoutLevels[
                  station.id
                ] ?? 0;
              const layout = station.layout ?? {
                x: 8 + (index % 5) * 20,
                y: 8 + Math.floor(index / 5) * 22,
              };
              return (
                <button
                  key={station.id}
                  className={`hideout-node ${selected?.id === station.id ? "active" : ""} ${level > 0 ? "built" : ""}`}
                  style={{ left: `${layout.x}%`, top: `${layout.y}%` }}
                  onClick={() => setSelectedId(station.id)}
                  title={uiText(station.name)}
                >
                  {uiText(station.imageUrl ? (
                    <img src={station.imageUrl} alt={uiText("")} />
                  ) : (
                    <Boxes size={18} />
                  ))}
                  <span>
                    <strong>{uiText(station.name)}</strong>
                    <small>{uiText(" ур. ")}{uiText(level)}/{uiText(station.maxLevel ?? 0)}
                    </small>
                  </span>
                </button>
              );
            }))}
          </div>
        </section>
        {uiText(selected && (
          <aside className="panel hideout-detail">
            <div className="panel-header">
              <div>
                <div className="eyebrow">{uiText("Модуль")}</div>
                <div className="panel-title">{uiText(selected.name)}</div>
              </div>
              {uiText(selected.imageUrl && <img src={selected.imageUrl} alt={uiText("")} />)}
            </div>
            <div className="panel-body">
              <div className="hideout-level-control">
                <button
                  className="icon-button"
                  onClick={() =>
                    state.setHideoutLevel(
                      selected.id,
                      Math.max(0, currentLevel - 1),
                    )
                  }
                >
                  <Minus size={15} />
                </button>
                <strong>{uiText("Уровень ")}{uiText(currentLevel)}</strong>
                <button
                  className="icon-button"
                  disabled={currentLevel >= (selected.maxLevel ?? 0)}
                  onClick={() =>
                    state.setHideoutLevel(selected.id, currentLevel + 1)
                  }
                >
                  <Plus size={15} />
                </button>
              </div>
              <small className="dim">{uiText("Указано игроком")}</small>
              <div className="divider" style={{ margin: "15px 0" }} />
              <div className="stat-label">
                {uiText(next ? `Для уровня ${next.level}` : "Максимальный уровень")}
              </div>
              {uiText(next?.stationRequirements?.length ? (
                <>
                  <div className="stat-label" style={{ marginTop: 10 }}>{uiText(" Модули ")}</div>
                  {uiText(next.stationRequirements.map((requirement) => (
                    <div className="quest-objective" key={requirement}>
                      <span className="objective-dot" />
                      <span>{uiText(requirement)}</span>
                    </div>
                  )))}
                </>
              ) : null)}
              {uiText(next?.requirements.length ? (
                <>
                  <div className="stat-label" style={{ marginTop: 10 }}>{uiText(" Предметы и условия ")}</div>
                  {uiText(next.requirements.map((requirement) => (
                    <div className="quest-objective" key={requirement}>
                      <span className="objective-dot" />
                      <span>{uiText(requirement)}</span>
                    </div>
                  )))}
                </>
              ) : (
                <p className="muted">
                  {uiText(next
                    ? "Предметные требования не указаны в источнике."
                    : "Дальнейших улучшений нет.")}
                </p>
              ))}
              {uiText(typeof next?.constructionTimeHours === "number" && (
                <p className="muted">{uiText(" Время постройки: ~")}{uiText(next.constructionTimeHours)}{uiText(" ч ")}</p>
              ))}
              <p className="muted">{uiText(next?.bonus ?? selected.bonus)}</p>
              {uiText(selected.levels && selected.levels.length > 1 && (
                <>
                  <div className="divider" style={{ margin: "15px 0" }} />
                  <div className="stat-label">{uiText("Все уровни")}</div>
                  {uiText(selected.levels.map((level) => (
                    <div className="quest-objective" key={level.level}>
                      <span className="objective-dot" />
                      <span>{uiText(" Ур. ")}{uiText(level.level)}:{uiText(" ")}
                        {uiText([
                          ...(level.stationRequirements ?? []),
                          ...level.requirements,
                        ]

                          .join(" · ") || level.bonus)}
                      </span>
                    </div>
                  )))}
                </>
              ))}
            </div>
          </aside>
        ))}
      </div>
    </div>
  );
}

export function TradersPage() {
  const { data } = useTarkovData();
  // The selected trader (and the opened quest) live in the address, so «Назад» returns to the previous quest.
  const [params, setParams] = useSearchParams();
  const selectedTrader = data.traders.find((trader) => trader.id === params.get("trader")) ?? data.traders[0];
  const selectedId = selectedTrader?.id ?? "";
  const setSelectedId = (id: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set("trader", id);
    if (id !== selectedId) next.delete("quest");
    return next;
  });
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText("Контакты")}</div>
          <h1 className="page-title">{uiText("Торговцы")}</h1>
          <p className="page-subtitle">{uiText("Выберите торговца: его задания идут по порядку выдачи в игре. Выполненные зачёркнуты, доступное задание открывается с полным описанием.")}</p>
        </div>
      </header>
      <div className="trader-grid">
        {uiText(data.traders.map((trader) => (
          <button
            className={`panel trader-card ${selectedId === trader.id ? "active" : ""}`}
            key={trader.id}
            onClick={() => setSelectedId(trader.id)}
            aria-label={uiText(trader.name)}
            aria-pressed={selectedId === trader.id}
          >
            <div
              className="trader-portrait"
              style={{ borderColor: trader.accent }}
            >
              {uiText(trader.imageUrl ? (
                <img src={trader.imageUrl} alt={uiText("")} />
              ) : (
                trader.name[0]
              ))}
            </div>
            <strong>{uiText(trader.name)}</strong>
          </button>
        )))}
      </div>
      {selectedTrader && <TraderQuestBoard trader={selectedTrader} />}
    </div>
  );
}

import { ThemePicker } from "../components/ThemePicker";
import { AppUpdateSettings } from "../components/AppUpdateSettings";

export function SettingsPage() {
  const { data, source, updatedAt } = useTarkovData();
  const state = useAppState();
  const { locale, setLocale } = useLocale();
  const [compact, setCompact] = useState(true);
  const raidSmoke = useRaidSmokeEnabled();
  const counts = data.metadata?.counts;
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText("Система")}</div>
          <h1 className="page-title">{uiText("Настройки")}</h1>
          <p className="page-subtitle">{uiText(" Локальные предпочтения и управление данными аккаунта. ")}</p>
        </div>
        <span className={`tag ${source === "demo" ? "danger" : "green"}`}>
          <HardDrive size={12} />{uiText(" ")}
          {uiText(source === "demo" ? "Демо-режим" : `Данные ${timeAgo(updatedAt)}`)}
        </span>
      </header>
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">{uiText("Интерфейс")}</div>
          </div>
          <div className="panel-body">
            <div className="setting-row">
              <span>
                <strong>{uiText("Компактные таблицы")}</strong>
                <small>{uiText("Больше строк на экране")}</small>
              </span>
              <button
                className={`toggle ${compact ? "on" : ""}`}
                onClick={() => setCompact(!compact)}
              >
                <span />
              </button>
            </div>
            <div className="setting-row">
              <span>
                <strong>{uiText("Дым за боссами")}</strong>
                <small>{uiText("Сигнальный дым в карточке рейда на обзоре")}</small>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={raidSmoke}
                aria-label={uiText("Дым за боссами")}
                className={`toggle ${raidSmoke ? "on" : ""}`}
                onClick={() => setRaidSmokeEnabled(!raidSmoke)}
              >
                <span />
              </button>
            </div>
            {raidSmoke && <RaidSmokeSettings />}
            <ThemePicker />
            <div className="setting-row">
              <span>
                <strong>{uiText("Язык интерфейса")}</strong>
                <small>{uiText("Первая версия")}</small>
              </span>
              <div className="locale-switch"><button className={locale === "ru" ? "active" : ""} onClick={() => setLocale("ru")}>RU</button><button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>EN</button></div>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">{uiText("Данные")}</div>
          </div>
          <div className="panel-body">
            {uiText(counts && (
              <div className="setting-row">
                <span>
                  <strong>{uiText("Каталог")}</strong>
                  <small>
                    {uiText(counts.quests.toLocaleString("ru-RU"))}{uiText(" заданий ·")}{uiText(" ")}
                    {uiText(counts.items.toLocaleString("ru-RU"))}{uiText(" предметов ·")}{uiText(" ")}
                    {uiText(counts.maps.toLocaleString("ru-RU"))}{uiText(" карт ")}</small>
                </span>
                <span className="tag brass">
                  {uiText(state.raidMode.toUpperCase())}
                </span>
              </div>
            ))}
            <AppUpdateSettings />
          </div>
        </section>
      </div>
      {usesWebAccount() && (
        <div className="settings-server stack">
          <ServerAddressPanel />
          <ServerAccountPanel />
        </div>
      )}
    </div>
  );
}
