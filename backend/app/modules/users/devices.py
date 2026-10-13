"""Rótulo do dispositivo de uma sessão, derivado do user-agent (FR-014).

Formato "Navegador no Sistema" (por exemplo, "Chrome no Android"). Quando nada é reconhecido,
"Dispositivo desconhecido". É só um rótulo amigável para a tela de sessões, não uma análise
precisa do user-agent.
"""

UNKNOWN_DEVICE = "Dispositivo desconhecido"

# A ordem importa: o Edge e o Opera se apresentam também como Chrome; o Chrome, como Safari.
_BROWSERS: tuple[tuple[str, str], ...] = (
    ("Edg/", "Edge"),
    ("OPR/", "Opera"),
    ("Firefox/", "Firefox"),
    ("Chrome/", "Chrome"),
    ("Safari/", "Safari"),
)

_SYSTEMS: tuple[tuple[str, str], ...] = (
    ("Android", "Android"),
    ("iPhone", "iPhone"),
    ("iPad", "iPad"),
    ("Windows", "Windows"),
    ("Mac OS X", "macOS"),
    ("Macintosh", "macOS"),
    ("Linux", "Linux"),
)


def _first_match(user_agent: str, table: tuple[tuple[str, str], ...]) -> str | None:
    return next((label for needle, label in table if needle in user_agent), None)


def device_label(user_agent: str) -> str:
    browser = _first_match(user_agent, _BROWSERS)
    system = _first_match(user_agent, _SYSTEMS)
    if browser and system:
        return f"{browser} no {system}"
    return browser or system or UNKNOWN_DEVICE
