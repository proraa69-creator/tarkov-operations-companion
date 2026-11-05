import type { BattlePassDocumentKind } from '../data/battlePassDocuments'
import blueprints from './map-markers/documents/blueprints.webp'
import financial from './map-markers/documents/financial.webp'
import folder from './map-markers/documents/folder.webp'
import medical from './map-markers/documents/medical.webp'
import pmcFiles from './map-markers/documents/pmc-files.webp'
import project from './map-markers/documents/project.webp'
import technical from './map-markers/documents/technical.webp'
import testDocs from './map-markers/documents/test-docs.webp'
import userDocs from './map-markers/documents/user-docs.webp'

/**
 * «Документы боевого пропуска» on the map (owner, 05.11.2026: «очень похожа на значок дверей… найди виды документов… найди их
 * картинки и пометь на карте в соответствии с каждым видом»; «просто силуэт документа… без цветных рамок»): each kind's own
 * picture from the game, cut out, nothing around it. The layer itself shows the folder the owner sent, turned 90° left.
 */
export const DOCUMENT_FOLDER_PICTURE = folder

export const DOCUMENT_PICTURES: Record<BattlePassDocumentKind, string> = {
  financial,
  medical,
  blueprints,
  'pmc-files': pmcFiles,
  'user-docs': userDocs,
  'test-docs': testDocs,
  technical,
  project,
}
