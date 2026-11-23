/// <reference types="vite/client" />

declare module '*.css'

/** True in a test build (TEST_BUILD=1 at build time; vite.config.ts). */
declare const __RAIDOS_TEST_BUILD__: boolean

declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
      }
    }
  }
}

