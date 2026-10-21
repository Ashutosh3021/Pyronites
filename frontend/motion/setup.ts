import { startCore } from './core'

/**
 * Global motion. Runs once on the client, before the first page initializes.
 *
 * The page transition is the ignition that ships with the engine (see
 * engine/transition.ts): a hot disc grows from the centre of the screen and
 * cools to basalt as it covers the view.
 */
export function setupMotion() {
  startCore()
}
