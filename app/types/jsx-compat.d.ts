/**
 * JSX Type Compatibility Layer for tsgo
 *
 * tsgo (TypeScript Go) has stricter JSX attribute type inference than tsc.
 * When writing `type="button"` in JSX, tsc infers it as the literal type `"button"`,
 * but tsgo infers it as `string`.
 *
 * This file provides module augmentations to extend the @remix-run/component
 * DOM types to accept strings where specific literal unions are expected.
 *
 * The pattern `(string & {})` allows any string while preserving autocomplete
 * suggestions for the known literal values.
 */

declare module '@remix-run/component' {
	// Re-export everything to avoid breaking imports
	export * from '@remix-run/component'
}

// Augment the global JSX namespace
declare global {
	namespace JSX {
		// Override IntrinsicElements to be more lenient with attribute types
		interface IntrinsicElements {
			// Button element - relax type and role attributes
			button: import('@remix-run/component/dist/lib/dom').ButtonHTMLProps<HTMLButtonElement> & {
				type?: 'submit' | 'reset' | 'button' | (string & {}) | undefined
				role?:
					| 'button'
					| 'checkbox'
					| 'combobox'
					| 'gridcell'
					| 'link'
					| 'menuitem'
					| 'menuitemcheckbox'
					| 'menuitemradio'
					| 'option'
					| 'radio'
					| 'separator'
					| 'slider'
					| 'switch'
					| 'tab'
					| 'treeitem'
					| (string & {})
					| undefined
			}

			// Input element - relax type attribute
			input: import('@remix-run/component/dist/lib/dom').InputHTMLProps<HTMLInputElement> & {
				type?: string | undefined
				role?: string | undefined
			}

			// Media elements - relax preload and loading attributes
			audio: import('@remix-run/component/dist/lib/dom').AudioHTMLProps<HTMLAudioElement> & {
				preload?: 'auto' | 'metadata' | 'none' | (string & {}) | undefined
			}

			video: import('@remix-run/component/dist/lib/dom').VideoHTMLProps<HTMLVideoElement> & {
				preload?: 'auto' | 'metadata' | 'none' | (string & {}) | undefined
			}

			img: import('@remix-run/component/dist/lib/dom').ImgHTMLProps<HTMLImageElement> & {
				loading?: 'eager' | 'lazy' | (string & {}) | undefined
			}

			// SVG elements - relax various attributes
			svg: import('@remix-run/component/dist/lib/dom').SVGProps<SVGSVGElement> & {
				'aria-hidden'?: boolean | 'true' | 'false' | (string & {}) | undefined
				role?: string | undefined
			}

			path: import('@remix-run/component/dist/lib/dom').SVGProps<SVGPathElement> & {
				'stroke-linecap'?:
					| 'butt'
					| 'round'
					| 'square'
					| 'inherit'
					| (string & {})
					| undefined
				'stroke-linejoin'?:
					| 'miter'
					| 'round'
					| 'bevel'
					| 'inherit'
					| (string & {})
					| undefined
			}

			// Div with relaxed role
			div: import('@remix-run/component/dist/lib/dom').HTMLProps<HTMLDivElement> & {
				role?: string | undefined
			}

			// Span with relaxed role
			span: import('@remix-run/component/dist/lib/dom').HTMLProps<HTMLSpanElement> & {
				role?: string | undefined
			}

			// Generic elements with aria-hidden support
			a: import('@remix-run/component/dist/lib/dom').AnchorHTMLProps<HTMLAnchorElement> & {
				role?: string | undefined
			}

			// Table row with relaxed role (for accessible clickable table rows)
			tr: import('@remix-run/component/dist/lib/dom').HTMLProps<HTMLTableRowElement> & {
				role?: string | undefined
			}
		}
	}
}

export {}
