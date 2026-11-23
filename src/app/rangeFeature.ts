/**
 * «Тир» (/arsenal/range) is for the owner's tests only for now (owner, 22.11.2026: «реализуй в тестовом приложении, не
 * публикуй, я буду тестировать и дорабатывать»): it shows in a development run and in a test build (TEST_BUILD=1 at build
 * time, scripts/write-build-info.mjs; vite.config.ts writes it into the bundle as __RAIDOS_TEST_BUILD__). A released build
 * has neither, so the page, its menu item and its route are left out.
 */
export const rangeEnabled = () => import.meta.env.DEV || __RAIDOS_TEST_BUILD__
