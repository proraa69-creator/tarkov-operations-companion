import type { ComponentProps } from 'react'
import { uiText } from '../i18n/renderText'
import { ImageViewerBase } from './ImageViewerBase'

// eslint-disable-next-line react-refresh/only-export-components -- a tiny query of the viewer's own state
export { imageViewerOpen } from './ImageViewerBase'

/** Images full size, in the app's language (ImageViewerBase.tsx). */
export function ImageViewer(props: Omit<ComponentProps<typeof ImageViewerBase>, 't'>) {
  return <ImageViewerBase {...props} t={uiText} />
}
