import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  Check,
  Crosshair,
  Database,
  ExternalLink,
  HardDrive,
  Heart,
  KeyRound,
  Minus,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { useTarkovData } from "../data/DataProvider";
import { useAppState } from "../state/AppState";
import { formatPrice, timeAgo } from "../shared/format";

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
          <div className="eyebrow">
            Рыночная разведка · {state.raidMode.toUpperCase()}
          </div>
          <h1 className="page-title">Экономика</h1>
          <p className="page-subtitle">
            Сравнение источников продажи. Все цены показывают режим и время
            последнего обновления.
          </p>
        </div>
        <span className={`tag ${source === "demo" ? "danger" : "green"}`}>
          <Database size={12} />{" "}
          {source === "demo" ? "демо-цены" : `обновлено ${timeAgo(updatedAt)}`}
        </span>
      </header>
      {source === "demo" && (
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
          />
          Tarkov.dev временно недоступен. Показаны встроенные демонстрационные
          значения — не используйте их для точного расчёта сделки.
        </div>
      )}
      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Рейтинг ценности</div>
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
              placeholder="Найти предмет…"
            />
          </div>
        </div>
        <div className="panel-body" style={{ overflowX: "auto" }}>
          <table className="price-table">
            <thead>
              <tr>
                <th>Предмет</th>
                <th>Категория</th>
                <th>Лучший источник</th>
                <th>Разница</th>
                <th>Цена</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, best, spread }) => (
                <tr key={item.id}>
                  <td>
                    <Link
                      to={`/items?selected=${item.id}`}
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <img className="item-thumb" src={item.iconUrl} alt="" />
                      <span>
                        <strong>{item.name}</strong>
                        <small className="dim" style={{ display: "block" }}>
                          {item.shortName}
                        </small>
                      </span>
                    </Link>
                  </td>
                  <td>
                    <span className="tag">{item.category}</span>
                  </td>
                  <td>{best.source}</td>
                  <td className="mono price-up">+{formatPrice(spread)}</td>
                  <td className="mono">
                    <strong>{formatPrice(best.price)}</strong>
                  </td>
                </tr>
              ))}
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
          <div className="eyebrow">Доступ и маршруты</div>
          <h1 className="page-title">Ключи</h1>
          <p className="page-subtitle">
            Где применяется ключ, какое задание открывает и сколько он стоит.
          </p>
        </div>
        <span className="tag brass">
          <KeyRound size={12} /> {keys.length} ключей
        </span>
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
            placeholder="Номер комнаты или название…"
          />
        </div>
      </div>
      <div className="grid-3">
        {keys.map((item) => {
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
                  alt={item.name}
                  style={{ maxHeight: 90 }}
                />
              </div>
              <div className="panel-body">
                <div className="eyebrow">{map?.name ?? "Разные локации"}</div>
                <h3 style={{ margin: "9px 0 7px" }}>{item.name}</h3>
                <p className="muted" style={{ minHeight: 58, lineHeight: 1.5 }}>
                  {item.description}
                </p>
                <div className="filter-row">
                  {quests.map(
                    (quest) =>
                      quest && (
                        <span className="tag brass" key={quest.id}>
                          {quest.name}
                        </span>
                      ),
                  )}
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
                    {price ? formatPrice(price.price) : "—"}
                  </strong>
                  <Link
                    className="button small"
                    to={`/items?selected=${item.id}`}
                  >
                    Подробнее <ArrowUpRight size={13} />
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
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
          <div className="eyebrow">Баллистика</div>
          <h1 className="page-title">Боеприпасы</h1>
          <p className="page-subtitle">
            Сравнение урона, пробития и цены для быстрой подготовки
            боекомплекта.
          </p>
        </div>
        <span className="tag green">
          <Crosshair size={12} /> сортировка по пробитию
        </span>
      </header>
      <div className="filter-row">
        <select
          className="select"
          value={caliber}
          onChange={(event) => setCaliber(event.target.value)}
        >
          {calibers.map((entry) => (
            <option key={entry}>{entry}</option>
          ))}
        </select>
      </div>
      <section className="panel">
        <div className="panel-body" style={{ overflowX: "auto" }}>
          <table className="price-table">
            <thead>
              <tr>
                <th>Патрон</th>
                <th>Калибр</th>
                <th>Урон</th>
                <th>Пробитие</th>
                <th>Против брони</th>
                <th>Цена</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
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
                        to={`/items?selected=${item.id}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <img className="item-thumb" src={item.iconUrl} alt="" />
                        <strong>{item.shortName}</strong>
                      </Link>
                    </td>
                    <td>{item.caliber}</td>
                    <td className="mono">{item.damage}</td>
                    <td>
                      <strong className="mono">{item.penetration}</strong>
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
                      <span className="tag brass">
                        до класса {effectiveClass}
                      </span>
                    </td>
                    <td className="mono">
                      {price ? formatPrice(price.price) : "—"}
                    </td>
                  </tr>
                );
              })}
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
          <div className="eyebrow">
            Инфраструктура · {state.raidMode.toUpperCase()}
          </div>
          <h1 className="page-title">Убежище</h1>
          <p className="page-subtitle">
            Выберите модуль на схеме. Уровни указываются вручную — журналы EFT
            не содержат надёжного состояния убежища.
          </p>
        </div>
        <span className="tag brass">
          <Boxes size={12} /> ручной учёт уровней
        </span>
      </header>
      <div className="hideout-layout">
        <section className="panel hideout-map" aria-label="Схема убежища">
          {data.hideout.map((station, index) => {
            const level =
              state.activeProfile.modes[state.raidMode].hideoutLevels[
                station.id
              ] ?? 0;
            return (
              <button
                key={station.id}
                className={`hideout-node ${selected?.id === station.id ? "active" : ""}`}
                style={{ gridColumn: (index % 4) + 1 }}
                onClick={() => setSelectedId(station.id)}
              >
                {station.imageUrl ? (
                  <img src={station.imageUrl} alt="" />
                ) : (
                  <Boxes size={20} />
                )}
                <span>
                  <strong>{station.name}</strong>
                  <small>
                    уровень {level}/{station.maxLevel ?? 0}
                  </small>
                </span>
              </button>
            );
          })}
        </section>
        {selected && (
          <aside className="panel hideout-detail">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Модуль</div>
                <div className="panel-title">{selected.name}</div>
              </div>
              {selected.imageUrl && <img src={selected.imageUrl} alt="" />}
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
                <strong>Уровень {currentLevel}</strong>
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
              <small className="dim">Указано игроком</small>
              <div className="divider" style={{ margin: "15px 0" }} />
              <div className="stat-label">
                {next ? `Для уровня ${next.level}` : "Максимальный уровень"}
              </div>
              {next?.requirements.length ? (
                next.requirements.map((requirement) => (
                  <div className="quest-objective" key={requirement}>
                    <span className="objective-dot" />
                    <span>{requirement}</span>
                  </div>
                ))
              ) : (
                <p className="muted">
                  {next
                    ? "Предметные требования не указаны в источнике."
                    : "Дальнейших улучшений нет."}
                </p>
              )}
              <p className="muted">{next?.bonus ?? selected.bonus}</p>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

export function TradersPage() {
  const { data } = useTarkovData();
  const [selectedId, setSelectedId] = useState(data.traders[0]?.id ?? "");
  const selected = data.traders.find((trader) => trader.id === selectedId);
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">Контакты</div>
          <h1 className="page-title">Торговцы</h1>
          <p className="page-subtitle">
            Выберите портрет торговца. Подробные данные появятся в следующих
            версиях.
          </p>
        </div>
        <span className="tag">
          <UserRound size={12} /> {data.traders.length} контактов
        </span>
      </header>
      <div className="trader-layout">
        <div className="trader-grid">
          {data.traders.map((trader) => (
            <button
              className={`panel trader-card ${selectedId === trader.id ? "active" : ""}`}
              key={trader.id}
              onClick={() => setSelectedId(trader.id)}
            >
              <div
                className="trader-portrait"
                style={{ borderColor: trader.accent }}
              >
                {trader.imageUrl ? (
                  <img src={trader.imageUrl} alt={trader.name} />
                ) : (
                  trader.name[0]
                )}
              </div>
              <strong>{trader.name}</strong>
            </button>
          ))}
        </div>
        {selected && (
          <section className="panel trader-detail">
            <div style={{ height: 5, background: selected.accent }} />
            <div className="panel-body">
              {selected.imageUrl && (
                <img
                  className="trader-detail-image"
                  src={selected.imageUrl}
                  alt={selected.name}
                />
              )}
              <div className="eyebrow">Торговец</div>
              <h2>{selected.name}</h2>
              <p className="muted">{selected.role}</p>
              <div className="import-note">
                Раздел подготовлен. Ассортимент, репутация и персональные
                предложения пока не подключены.
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { data, source, updatedAt, refresh, isFetching } = useTarkovData();
  const state = useAppState();
  const [reduced, setReduced] = useState(false);
  const [compact, setCompact] = useState(true);
  const counts = data.metadata?.counts;
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">Система</div>
          <h1 className="page-title">Настройки</h1>
          <p className="page-subtitle">
            Локальные предпочтения, данные и сведения об источниках.
          </p>
        </div>
        <span className={`tag ${source === "demo" ? "danger" : "green"}`}>
          <HardDrive size={12} />{" "}
          {source === "demo" ? "Демо-режим" : `Данные ${timeAgo(updatedAt)}`}
        </span>
      </header>
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">Интерфейс и режим</div>
          </div>
          <div className="panel-body">
            <div className="setting-row">
              <span>
                <strong>Экономика</strong>
                <small>Глобальный режим рынка</small>
              </span>
              <div className="mode-switch">
                <button
                  className={state.raidMode === "pvp" ? "active" : ""}
                  onClick={() => state.setRaidMode("pvp")}
                >
                  PvP
                </button>
                <button
                  className={state.raidMode === "pve" ? "active" : ""}
                  onClick={() => state.setRaidMode("pve")}
                >
                  PvE
                </button>
                <button
                  className={state.raidMode === "seasonal" ? "active" : ""}
                  onClick={() => state.setRaidMode("seasonal")}
                >
                  Сезон
                </button>
              </div>
            </div>
            <div className="setting-row">
              <span>
                <strong>Компактные таблицы</strong>
                <small>Больше строк на экране</small>
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
                <strong>Сократить анимацию</strong>
                <small>Меньше переходов и движения</small>
              </span>
              <button
                className={`toggle ${reduced ? "on" : ""}`}
                onClick={() => setReduced(!reduced)}
              >
                <span />
              </button>
            </div>
            <div className="setting-row">
              <span>
                <strong>Язык интерфейса</strong>
                <small>Первая версия прототипа</small>
              </span>
              <span className="tag brass">Русский</span>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">Данные</div>
          </div>
          <div className="panel-body">
            <div className="setting-row">
              <span>
                <strong>Источник</strong>
                <small>
                  {source === "demo"
                    ? "Встроенный демонстрационный набор"
                    : "json.tarkov.dev · русский каталог"}
                </small>
              </span>
              <span className={`tag ${source === "demo" ? "danger" : "green"}`}>
                {source}
              </span>
            </div>
            {counts && (
              <div className="setting-row">
                <span>
                  <strong>Каталог</strong>
                  <small>
                    {counts.quests.toLocaleString("ru-RU")} заданий ·{" "}
                    {counts.items.toLocaleString("ru-RU")} предметов ·{" "}
                    {counts.maps.toLocaleString("ru-RU")} карт
                  </small>
                </span>
                <span className="tag brass">
                  {state.raidMode.toUpperCase()}
                </span>
              </div>
            )}
            <div className="setting-row">
              <span>
                <strong>Обновить сейчас</strong>
                <small>
                  {isFetching
                    ? "Запрос выполняется…"
                    : `Последнее: ${timeAgo(updatedAt)}`}
                </small>
              </span>
              <button className="button small" onClick={refresh}>
                <RotateCcw size={13} /> Обновить
              </button>
            </div>
            <div className="setting-row">
              <span>
                <strong>Локальный прогресс</strong>
                <small>Активные задания, избранное и слои</small>
              </span>
              <button
                className="button small danger"
                onClick={() => {
                  if (window.confirm("Сбросить весь локальный прогресс?"))
                    state.reset();
                }}
              >
                Сбросить
              </button>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">Источники и лицензии</div>
            <ShieldCheck size={16} className="dim" />
          </div>
          <div className="panel-body stack">
            <p className="muted" style={{ lineHeight: 1.65 }}>
              Неофициальный некоммерческий компаньон. Не читает память игры, не
              внедряется в процесс и не автоматизирует игровые действия.
            </p>
            <a
              className="button ghost"
              href="https://tarkov.dev"
              target="_blank"
              rel="noreferrer"
            >
              Tarkov.dev <ExternalLink size={14} />
            </a>
            <a
              className="button ghost"
              href="https://github.com/the-hideout/tarkov-dev-svg-maps"
              target="_blank"
              rel="noreferrer"
            >
              SVG-карты · CC BY-NC-SA 4.0 <ExternalLink size={14} />
            </a>
            <a
              className="button ghost"
              href="https://www.escapefromtarkov.com"
              target="_blank"
              rel="noreferrer"
            >
              Escape from Tarkov <ExternalLink size={14} />
            </a>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">Состояние прототипа</div>
            <TrendingUp size={16} className="dim" />
          </div>
          <div className="panel-body">
            <div className="quest-objective">
              <Check size={15} color="var(--green)" />
              <span>Командный центр и планирование рейда</span>
            </div>
            <div className="quest-objective">
              <Check size={15} color="var(--green)" />
              <span>Карты, интерактивные маркеры и слои</span>
            </div>
            <div className="quest-objective">
              <Check size={15} color="var(--green)" />
              <span>Задания, предметы, ключи и экономика</span>
            </div>
            <div className="quest-objective">
              <Heart size={15} color="var(--brass)" />
              <span>Готово к пользовательской оценке</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
