import { isObject } from '../../../../shared/is-object.ts'
import { truncateToolText, type ToolCallPresentation } from './shared.ts'

/** Presents the short task description supplied for a delegated agent. */
export function agentPresentation(args: unknown): ToolCallPresentation {
  if (!isObject(args) || typeof args.description !== 'string' || !args.description.trim()) return {}

  const description = args.description.trim()
  return {
    headerDetail: { text: truncateToolText(description, 80).text, title: description },
  }
}
