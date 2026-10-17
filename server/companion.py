"""Local response provider for the no-credentials FocusLock demonstration."""


def create_demo_reply(message: str) -> str:
    text = message.casefold()
    if any(word in text for word in ("stressed", "overwhelmed", "anxious", "tired")):
        return (
            "That sounds like a lot to carry. Try making the next step smaller: "
            "write down one thing you can do in five minutes, then begin there."
        )
    if any(word in text for word in ("quiz", "study", "remember", "learn")):
        return (
            "Try a quick active-recall check: close your notes and explain the main "
            "idea in two sentences. Then reopen them and see what you missed."
        )
    if any(word in text for word in ("focus", "distract", "scroll", "procrastinat")):
        return (
            "Pick one task you can finish in this session, put distracting tabs away, "
            "and start with just the first small step. You can adjust the plan later."
        )
    if any(word in text for word in ("joke", "funny", "laugh")):
        return "Why did the notebook look calm? It had all its thoughts in one place."
    if any(word in text for word in ("hello", "hi ", "hey")):
        return (
            "Hi, I’m Nova. I’m the local study companion demo. What are you working on today?"
        )
    return (
        "I’m here to help you make your next study step clear. Tell me what you’re "
        "working on, or ask for a quick focus suggestion."
    )
