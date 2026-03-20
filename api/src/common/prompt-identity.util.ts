export const normalizePromptIdentity = (value: string): string => {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/[!?.:,;'"«»()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
