/// <reference types="vite/client" />

declare module '*.css'

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


/** Set by vite.config.ts: true only for the Hand Control test edition. */
declare const __RAIDOS_HAND_CONTROL__: boolean
