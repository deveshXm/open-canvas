[4:40] Understanding LangGraph and going through the repo using Claude Code to understand the structure and use case.

[4:52] Running two Claude Code agents side by side to debug yarn installation issue and understanding the assignment ( doc 1 ).

[4;58] Asking each instance to explain me the stories in flow chart and the task i need to achieve. Parallel working to complete the tasks fast.

[5:05] Remove the Lang Graph deprication page to use the app.

[5:10] Using Claude Code superpowers:brainstorm plugin for more exploration and understanding of the challenges

[5:14] Using a Third Claude Code to debug some confusions around auth 

[5:15] Planning for changing and creating doc for both the changes.

[5:25] Planned for all the feature requirements. Launching sub agents for each feature 1 and 2 for story 1 as they are easy to implement and one sub agent for story 2. implementation and debugging using execute-plan superpowers. Individual branch for each PR easier reviewing as well.

[5:46] Reviewing the code. trying to run the server but it's throwing errors.

[5:59] Server is not able to to connect with supabase. trying to find out why.

# Decisions made for the features

## Artificat Sharing

- Inline suggestion UI - don't want to deal with rendering library errors
- Don't focus on unecessary share expiry problems etc
- Worked on view only and copy work and suggesting inline-changes is complex hence we only made it till creating APIs and not UI.

## Multi Artifact Sharing

- No trade-offs - very straightforwared.
- Focused on this feature first.



 