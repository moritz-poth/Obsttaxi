# DirtyDave FM

Put your own music files here (mp3, m4a, ogg, wav, flac; subfolders are fine), then run once:

    node tools/playlist.mjs

That writes `music/playlist.js`, which the game reads on start. In the game: R turns the radio on/off, T skips to the next track. The tracks are shuffled.

Music files and the generated playlist are not committed (see .gitignore).
