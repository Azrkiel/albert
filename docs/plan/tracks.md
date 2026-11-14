# Albert — Tracks

How Albert meets each prize track's rules, where in the build that happens, and what evidence to collect. `pnpm check:tracks` (built in P8.3) checks the machine-checkable parts of this file.

Evidence collected during the event goes in `docs/tracks/`:

```
docs/tracks/
  amazon.md        langchain.md      peri.md
  mongodb.md       spacexsi.md       education.md
  img/             # screenshots and photos referenced by the files above
```

## 0. Confirm at the event

These could not be verified from outside the event. Ask at the organizer or sponsor table on Friday and write the answers into this file.

| # | Question | Who to ask | Why it matters |
|---|---|---|---|
| C1 | Which MLH categories are offered at HackPrinceton this weekend? Specifically "Best Use of MongoDB Atlas" and "Build Your Hackathon A-Team with SpaceXSI" | MLH table | Both are on MLH's season list, but each event offers a subset |
| C2 | Is the SpaceXSI category the Cursor + Grok Bot raffle, or a judged prize for using the Grok API? | MLH table or SpaceXSI rep | Decides whether any Grok API use belongs in the product (§8) |
| C3 | Does the Amazon prize expect an AWS service, or is any provider fine? | Amazon rep | The written rules allow any provider. Bedrock is our default either way |
| C4 | What do "charity" and "avidity" mean in the main rubric (creativity, utility, charity, avidity)? | Organizers | Shapes the last 30 seconds of the pitch |
| C5 | What form should Peri's evidence take, and where is it submitted? | Peri rep | The rules ask for a name, a role and one piece of evidence |
| C6 | Submission deadline, demo length, and whether judging is science-fair style or on stage | Organizers | Sets G5 and G6 clock times and the demo script |
| C7 | Does LangChain have an example of what "best use" means to them? | LangChain rep | Sharpens what the run panel should show |

---

## 1. Education (required main track)

**Rule.** Projects that make learning more interactive, accessible or personalized.

**How Albert fits.**
- *Interactive:* the student works by hand and Albert writes back on the same page.
- *Personalized:* hints use this course's methods and notation, and the study plan comes from this student's own mistakes.
- *Accessible:* it runs in a browser with a mouse, finger or stylus. No app, no tablet required.

**Built in.** All phases. The demo is the evidence.

**Pitch line.** "AI tutors make you type your problem into a chat box and then teach you a method your class never covered. Albert works on the page, in your handwriting, the way your professor taught it."

**Checklist**
- [ ] Education selected as the required track on the submission form
- [ ] The demo shows all three words: interactive, personalized, accessible

## 2. Best Overall

Automatic. Scored on creativity, utility, charity and avidity (see C4). Track winners cannot also win it, so it needs no separate work. The demo in Phase 8 is built to be strong on creativity (handwriting written back) and utility (scope-aware hints from the real course).

## 3. Best Rookie (optional)

**Rule.** Best project by hackers at their first hackathon.

- [ ] Only opt in if every team member qualifies. Confirm the definition with organizers.

## 4. Amazon — Best Practical AI Innovation

**What the rules ask for.** AI that solves a real problem for real people and goes beyond a demo: it reasons, plans, acts and adapts. Scored equally on creativity, usefulness, technical implementation and user experience. A submission must include a working prototype, a clear use case and target user, basic documentation and a pitch. Any model provider or framework is allowed.

**How Albert meets each focus area.**

| Focus area | In Albert | Phase |
|---|---|---|
| Agentic behavior | The course agent plans with a todo list, delegates units to sub-agents, checks its own cards and repairs them, then builds a plan | 6 |
| Real-world impact | Students stuck on homework at midnight with no tutor. Confirmed with a real tutoring organization (the Peri visit) | 8 |
| Adaptive intelligence | Skill levels change with every session and the study plan is rewritten from the new evidence | 6, 7 |
| User-friendly design | No chat box and no prompt to write. You do your homework and help appears on the page | 2, 4 |
| Creative innovation | The tutor's handwriting appears next to yours and points at the exact symbol | 4 |

**Required items**

| Item | Where |
|---|---|
| Working prototype | The app, plus the backup video |
| Clear use case and target user | `README.md`, first section |
| Basic documentation | `README.md`: what it is, how to run it, architecture diagram |
| Pitch | The demo script in Phase 8 |

**Evidence to collect** in `docs/tracks/amazon.md`
- [ ] A screenshot of the Bedrock console or a `pnpm smoke` log showing the model id in use
- [ ] One sentence on which Claude models run the hints and the agent

**Pitch line.** "Albert's agent reads your whole course so its two-second hints can stay inside what you've been taught, and it re-plans your week after every session. The reasoning runs on Claude through Amazon Bedrock."

**Checklist**
- [ ] `LLM_PROVIDER=bedrock` in the demo environment, or a note in the write-up if the fallback was used
- [ ] README has the four required items
- [ ] The demo shows the plan changing after a session (adaptive)

## 5. LangChain — Best use of deepagents

**Rule.** Build a deep agent for any use case.

**What makes it a real use, not a wrapper.** Deep Agents provides planning, sub-agents, a file system, skills and memory. The course agent uses all five for a reason:

| Capability | Used for | Visible where |
|---|---|---|
| Planning (todo list) | Breaking "learn this course" into units and worksheets, and tracking them | Run panel: the todo list ticking off |
| Sub-agents | `unit-reader` per unit, `worksheet-mapper`, `card-checker`, `planner`. Each keeps a long PDF out of the main context | Run panel: sub-agent start and end lines |
| File system | Notes per unit, a scope summary, the working plan | Run panel: file writes. Files listed on the course page |
| Skills | `teaching-card`, `study-plan`, and the adapted `socratic-tutor` skill loaded on demand | `skills/` in the repo |
| Memory | Notes about the student that persist across runs, stored in MongoDB | The "how you're doing" summary that reflects earlier sessions |

**Built in.** Phase 6.

**Evidence to collect** in `docs/tracks/langchain.md`
- [ ] A screenshot or short clip of the run panel during ingestion
- [ ] The architecture diagram with the agent's parts labelled
- [ ] A link to `src/lib/agent/` and `skills/`
- [ ] Optional: a LangSmith trace link, if tracing is enabled

**Pitch line.** "This is a deep agent doing what deep agents are for: reading a whole course, delegating each unit to a sub-agent, checking its own work, and remembering the student between runs."

**Checklist** (the first three are checked by `pnpm check:tracks`)
- [ ] `deepagents` is a dependency and `createDeepAgent` is called in `src/lib/agent/`
- [ ] At least three sub-agents are defined
- [ ] `skills/` contains at least two skills with `SKILL.md`
- [ ] The run panel is in the demo for at least 15 seconds

## 6. Peri — Forward Deployed Challenge

**Rule.** Build a project that solves a real problem for a real business you consulted *during the hackathon*: a local shop, a family business, a startup. Student organizations and clubs qualify. A submission must include the name of the business, the name and role of the person consulted, and one piece of evidence (a screenshot of the conversation, a photo, a short video or a direct quote). Scored on real-world need, usability (could they adopt it now) and execution.

**Without the three required items the entry is ineligible.** This is the only track that cannot be finished from a laptop.

**An honest read of the odds.** Peri's ideal entry starts from a business's problem and builds what that business asks for. Albert starts from an idea and takes it to a business. That is allowed, but it will score lower on "real-world need" unless the conversation visibly reshapes something. So go early, listen for what they actually want, and let the tutor report and the one change be *theirs*. If the conversation produces nothing that changes the product, say so plainly in the write-up; do not dress it up.

**Who to consult.** Any organization that tutors math. In rough order of how quickly they can usually be reached:
1. A campus tutoring program or learning center
2. A teaching assistant or preceptor for a calculus course, speaking for their course staff
3. A student math club or a peer-tutoring student organization
4. A local tutoring business near campus
5. A teacher at a local school

**What to ask** (15 minutes; full script in P8.2)
1. How do your students get help between sessions today?
2. Where do they most often get stuck, and how do you find out?
3. What goes wrong when they use AI chat tools for homework?
4. If a tool told you where each student got stuck this week, what would you do with it?
5. What would stop you from using this next week?

**How the visit changes the build.** Peri scores whether the business could adopt the solution immediately, so the conversation must leave a mark on the product. Two things are already planned to carry it:
- The **tutor report** (P7.4): a one-page summary of where a student got stuck, for the tutor's next session. This is the business-facing feature.
- One **change made because of the conversation**, recorded in `docs/tracks/peri.md` with the commit. P8.2 reserves an hour for it.

**Evidence to collect** in `docs/tracks/peri.md`
- [ ] Organization name
- [ ] Person's name and role, with their permission to be named
- [ ] One piece of evidence: a photo, a screenshot of the conversation, or a direct quote
- [ ] Two or three findings in their words
- [ ] The change made in response, with its commit
- [ ] If possible: their reaction to the working demo on Sunday morning

**Pitch line.** "We asked *[person, role, organization]* how their students get help between sessions. They told us *[finding]*. So Albert gives the tutor a one-page report of exactly where each student got stuck."

**Checklist**
- [ ] Outreach message sent Friday night to at least three organizations
- [ ] Conversation held by Saturday 3 p.m.
- [ ] `docs/tracks/peri.md` complete (checked by `pnpm check:tracks`)
- [ ] The Peri track selected on the submission form, with the three required items in the description

## 7. MLH — Best Use of MongoDB Atlas

**Rule.** Use MongoDB Atlas in the project. (Confirm it is offered: C1.)

**How Albert uses it.** One Atlas cluster holds:
- Stroke sessions as event documents
- Teaching cards, worksheets and study plans as nested documents
- Evidence events and computed skill levels
- The course agent's checkpoints and long-term memory, through LangGraph's MongoDB checkpointer and store
- Cached course files in GridFS

The point to make is that the app's data and the agent's memory are the same store, so a study plan can cite the evidence documents it was built from.

**Built in.** P1.5 (cluster and `Repo`), P6.2 (agent checkpoints and memory).

**Stretch.** Atlas Vector Search over worked examples, so a hint can retrieve the closest example from the lectures (P8.7). Only worth doing if a MongoDB judge is present and Phase 7 is finished.

**Evidence to collect** in `docs/tracks/mongodb.md`
- [ ] A screenshot of the Atlas collections with document counts
- [ ] One example document each for a session event, a teaching card and a plan

**Checklist**
- [ ] `STORE=mongo` in the demo environment (checked by `pnpm smoke`)
- [ ] The agent's checkpointer is the MongoDB one when `STORE=mongo`

## 8. MLH — Build Your Hackathon A-Team with SpaceXSI

**Rule, as MLH publishes it this season.** Build the project with Cursor and Grok Bot to enter a raffle. Specifically: use Cursor as the core AI coding agent, integrate a Grok Bot automation into the workflow, describe how both were used in the project description, and opt in to the raffle. (Confirm: C1, C2.)

**What this means for Albert.** The category is about *how the project is built*. It does not ask for Grok inside the product. So:

- **The product keeps Claude as its model.** No hint or agent call needs to change for this track.
- **The team builds in Cursor.** `AGENTS.md` at the repo root points Cursor's agent at this plan, so it works from the same subphases and acceptance criteria as everyone else.
- **A Grok Bot automation runs during the build.** Grok Bot is an agent with its own cloud computer that can repeat a task on a schedule. The planned automation is *Verifier*: once an hour it pulls `main`, runs `pnpm verify` and `pnpm e2e`, and reports the result (P1.7). It is a real part of the workflow because it is what tells the team that `main` is still demoable.

**If the on-site rules differ (C2).** If the SpaceXSI prize at HackPrinceton is judged on Grok API use:
1. Set `LLM_PROVIDER=xai` for the course agent only (`AGENT_PROVIDER` override in `src/lib/llm`, built in P1.4). The agent then plans the student's week on Grok.
2. Keep the hint path on the model chosen in P3.5. It was tuned and evaluated on that model and there is no time to redo it.
3. Say exactly that in the write-up: which parts run on which model.

Do this only if a SpaceXSI representative confirms it matters. Otherwise it is work with no payoff.

**Evidence to collect** in `docs/tracks/spacexsi.md`
- [ ] A screenshot of Cursor working on a subphase from this plan
- [ ] A screenshot of the Grok Bot automation and one of its reports
- [ ] Two or three sentences for the project description on how each was used

**Checklist**
- [ ] `AGENTS.md` exists at the repo root (checked by `pnpm check:tracks`)
- [ ] The automation ran at least three times during the event
- [ ] The project description has a "How we built it" paragraph naming Cursor and Grok Bot
- [ ] Opted in to the raffle on the submission form

## 9. Stretch and skipped

| Track | Status | Note |
|---|---|---|
| MLH — Best Use of ElevenLabs | Stretch (P8.7) | Voice narration of hints. The browser's built-in speech is the zero-cost first step; swap in ElevenLabs only if the category is offered and time allows |
| MLH — Best .Tech Domain Name | Optional | Ten minutes if someone has them. Not planned |
| CoStar — AI for the Built World | Skip | Needs their property data. Not a fit |
| Arlequin AI | Skip | Forensics and social-network analysis. Not a fit |
| Best Physical AI Hack, Best Hardware Hack | Skip | A stylus is an input device, not a hardware build |
| Healthcare, Sustainability, Business, Entertainment, Science | Skip | One required main track only |

## 10. Submission form checklist

Fill this in at G5. The project description template is in P8.5.

- [ ] Required track: **Education**
- [ ] Optional: Best Rookie (if eligible)
- [ ] Sponsor: Amazon — Best Practical AI Innovation
- [ ] Sponsor: LangChain — Best use of deepagents
- [ ] Sponsor: Peri — Forward Deployed Challenge, with business name, person and role, and evidence in the description
- [ ] MLH: Best Use of MongoDB Atlas (if offered)
- [ ] MLH: SpaceXSI raffle (if offered), with the Cursor and Grok Bot paragraph
- [ ] Repository link, demo video link, and the live link if deployed
