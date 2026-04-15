/**
 * Replaces known player names in text with {player1}, {player2}, etc.
 * Used before storing punchlines in DB so they're reusable across games.
 */
export function replaceNamesWithPlaceholders(
  text: string,
  playerNames: readonly string[]
): string {
  if (playerNames.length === 0 || !text) {
    return text
  }
  let result = text
  // Sort by length descending so longer names are replaced first
  // (prevents partial matches when one name is a prefix of another)
  const sorted = [...playerNames]
    .map((name, index) => ({ name, index }))
    .sort((a, b) => b.name.length - a.name.length)
  for (const { name, index } of sorted) {
    if (name.length < 2) {
      continue
    }
    const escaped = escapeRegex(name)
    const pattern = new RegExp(escaped, 'gi')
    result = result.replace(pattern, `{player${index + 1}}`)
  }
  return result
}

/**
 * Replaces {player1}, {player2}, etc. with actual player names.
 * Used when displaying stored punchlines or feeding memory examples to the model.
 */
export function replacePlaceholdersWithNames(
  text: string,
  playerNames: readonly string[]
): string {
  if (playerNames.length === 0 || !text) {
    return text
  }
  let result = text
  for (let i = 0; i < playerNames.length; i++) {
    const placeholder = `{player${i + 1}}`
    result = result.split(placeholder).join(playerNames[i])
  }
  // Also handle generic {player} — substitute with a random name
  if (result.includes('{player}') && playerNames.length > 0) {
    const randomName = playerNames[Math.floor(Math.random() * playerNames.length)]
    result = result.split('{player}').join(randomName)
  }
  return result
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
