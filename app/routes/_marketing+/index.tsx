import { type Route } from './+types/index.ts'

export const meta: Route.MetaFunction = () => [
	{ title: 'mediarss - RSS Feeds for Your Media' },
]

export default function Index() {
	return (
		<main className="font-poppins container flex h-full items-center justify-center">
			<div className="flex flex-col items-center justify-center gap-12 px-4 py-16 xl:flex-row xl:gap-24">
				<div className="flex max-w-md flex-col items-center text-center xl:items-start xl:text-left">
					<a
						href="/"
						className="animate-slide-top [animation-fill-mode:backwards] xl:animate-slide-left xl:[animation-delay:0.5s] xl:[animation-fill-mode:backwards]"
					>
						<svg
							className="size-20 text-foreground xl:-mt-4"
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 65 65"
						>
							<path
								fill="currentColor"
								d="M39.445 25.555 37 17.163 65 0 47.821 28l-8.376-2.445Zm-13.89 0L28 17.163 0 0l17.179 28 8.376-2.445Zm13.89 13.89L37 47.837 65 65 47.821 37l-8.376 2.445Zm-13.89 0L28 47.837 0 65l17.179-28 8.376 2.445Z"
							></path>
						</svg>
					</a>
					<h1
						data-heading
						className="mt-8 animate-slide-top text-4xl font-medium text-foreground [animation-delay:0.3s] [animation-fill-mode:backwards] md:text-5xl xl:mt-4 xl:animate-slide-left xl:text-6xl xl:[animation-delay:0.8s] xl:[animation-fill-mode:backwards]"
					>
						mediarss
					</h1>
					<p
						data-paragraph
						className="mt-6 animate-slide-top text-xl/7 text-muted-foreground [animation-delay:0.8s] [animation-fill-mode:backwards] xl:mt-8 xl:animate-slide-left xl:text-xl/6 xl:leading-10 xl:[animation-delay:1s] xl:[animation-fill-mode:backwards]"
					>
						Generate RSS feeds for your media files. Share your videos and audio
						content with the world through standard RSS feeds that work with any
						podcast or video player.
					</p>
				</div>
				<div className="flex flex-wrap justify-center gap-4">
					<div className="grid grid-cols-2 gap-4">
						<div className="rounded-2xl bg-violet-600/10 p-6 transition hover:bg-violet-600/15 dark:bg-violet-200 dark:hover:bg-violet-100">
							<h3 className="text-lg font-semibold">Video Support</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Generate RSS feeds for your video content, compatible with
								popular video players and platforms.
							</p>
						</div>
						<div className="rounded-2xl bg-violet-600/10 p-6 transition hover:bg-violet-600/15 dark:bg-violet-200 dark:hover:bg-violet-100">
							<h3 className="text-lg font-semibold">Audio Support</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Create podcast-style RSS feeds for your audio content, ready for
								any podcast app.
							</p>
						</div>
					</div>
				</div>
			</div>
		</main>
	)
}
