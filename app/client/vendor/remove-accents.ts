/**
 * Browser ESM stand-in for the CommonJS-only `remove-accents` package that
 * `match-sorter` imports. Uses Unicode decomposition plus a small table for the
 * letters that have no decomposed form.
 */

const specialCharacters: Record<string, string> = {
	Æ: 'AE',
	æ: 'ae',
	Ð: 'D',
	ð: 'd',
	Đ: 'D',
	đ: 'd',
	Ħ: 'H',
	ħ: 'h',
	ı: 'i',
	Ĳ: 'IJ',
	ĳ: 'ij',
	ĸ: 'k',
	Ł: 'L',
	ł: 'l',
	Ŀ: 'L',
	ŀ: 'l',
	Ŋ: 'N',
	ŋ: 'n',
	Ø: 'O',
	ø: 'o',
	Œ: 'OE',
	œ: 'oe',
	ß: 'ss',
	Ŧ: 'T',
	ŧ: 't',
	Þ: 'TH',
	þ: 'th',
}

const specialCharactersPattern = new RegExp(
	`[${Object.keys(specialCharacters).join('')}]`,
	'g',
)

export default function removeAccents(input: string): string {
	return input
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(
			specialCharactersPattern,
			(character) => specialCharacters[character] ?? character,
		)
}

export const has = (input: string) => removeAccents(input) !== input
export const remove = removeAccents
