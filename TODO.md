# TODO - Add `streamText` streaming demo

- [ ] Verify `ai` dependency added to root `package.json`
- [ ] Ensure Supabase Edge Function `generate-date-ideas-stream` compiles (fix TS typing + runtime provider config)
- [ ] Wire frontend streaming button (`Generate (stream)`) to `window.app.streamIdeas()`
- [ ] Implement `window.app.streamIdeas()` in `main.js` to call `streamDateIdeas` and render streamed text
- [ ] Ensure Edge Function endpoint URL and SSE parsing match frontend
- [ ] Run `npm run dev` and manually test streaming UI

