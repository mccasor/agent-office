// Generato da src/shared/settings.ts con `npm run settings:catalog`: non modificare a mano.
globalThis.AGENT_OFFICE_SETTINGS = {
  "tabs": [
    {
      "id": "general",
      "label": "Generali"
    },
    {
      "id": "claude",
      "label": "Claude"
    },
    {
      "id": "agents",
      "label": "Agenti"
    },
    {
      "id": "git",
      "label": "Git"
    },
    {
      "id": "instances",
      "label": "Istanze"
    }
  ],
  "places": {
    "office": "Ufficio",
    "instances": "Istanze",
    "card": "Scheda",
    "list": "Lista",
    "panel": "Menu bar"
  },
  "items": [
    {
      "key": "session.model",
      "tab": "claude",
      "label": "Modello",
      "places": [
        "instances",
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "session.effort",
      "tab": "claude",
      "label": "Effort",
      "places": [
        "instances",
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "session.tokens",
      "tab": "claude",
      "label": "Token generati",
      "places": [
        "instances",
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "session.cost",
      "tab": "claude",
      "label": "Costo stimato",
      "places": [
        "instances",
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "session.context",
      "tab": "claude",
      "label": "Contesto usato",
      "places": [
        "instances",
        "list",
        "card",
        "panel"
      ],
      "default": true
    },
    {
      "key": "session.turn",
      "tab": "claude",
      "label": "Durata del turno",
      "places": [
        "instances",
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "session.title",
      "tab": "claude",
      "label": "Titolo della conversazione",
      "places": [
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "session.toolErrors",
      "tab": "claude",
      "label": "Errori dei tool",
      "places": [
        "card"
      ],
      "default": true
    },
    {
      "key": "session.activity",
      "tab": "claude",
      "label": "Attività sotto l'istanza",
      "places": [
        "panel"
      ],
      "default": true
    },
    {
      "key": "agent.role",
      "tab": "agents",
      "label": "Ruolo",
      "places": [
        "office",
        "instances",
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "agent.task",
      "tab": "agents",
      "label": "Compito",
      "places": [
        "instances",
        "list",
        "card",
        "panel"
      ],
      "default": true
    },
    {
      "key": "agent.type",
      "tab": "agents",
      "label": "Tipo di agente",
      "places": [
        "card"
      ],
      "default": true
    },
    {
      "key": "agent.description",
      "tab": "agents",
      "label": "Descrizione",
      "places": [
        "card"
      ],
      "default": true
    },
    {
      "key": "agent.issues",
      "tab": "agents",
      "label": "Issue",
      "places": [
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "agent.progress",
      "tab": "agents",
      "label": "Avanzamento",
      "places": [
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "agent.duration",
      "tab": "agents",
      "label": "Durata",
      "places": [
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "agent.model",
      "tab": "agents",
      "label": "Modello",
      "places": [
        "card"
      ],
      "default": true
    },
    {
      "key": "agent.effort",
      "tab": "agents",
      "label": "Effort",
      "places": [
        "card"
      ],
      "default": true
    },
    {
      "key": "agent.tokens",
      "tab": "agents",
      "label": "Token",
      "places": [
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "agent.cost",
      "tab": "agents",
      "label": "Costo stimato",
      "places": [
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "agent.outcome",
      "tab": "agents",
      "label": "Esito dei terminati",
      "places": [
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "agent.toolErrors",
      "tab": "agents",
      "label": "Errori dei tool",
      "places": [
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "agent.alerts",
      "tab": "agents",
      "label": "Avviso se fermo o in loop",
      "places": [
        "office",
        "instances",
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "office.labels",
      "tab": "agents",
      "label": "Nomi sopra i personaggi",
      "places": [
        "office"
      ],
      "default": true
    },
    {
      "key": "office.bubbles",
      "tab": "agents",
      "label": "Fumetto di chi aspetta",
      "places": [
        "office"
      ],
      "default": true
    },
    {
      "key": "panel.agents",
      "tab": "agents",
      "label": "Agenti sotto le istanze",
      "places": [
        "panel"
      ],
      "default": true
    },
    {
      "key": "session.branch",
      "tab": "git",
      "label": "Branch",
      "places": [
        "instances",
        "list",
        "card",
        "panel"
      ],
      "default": true
    },
    {
      "key": "session.diff",
      "tab": "git",
      "label": "Modifiche non committate",
      "places": [
        "instances",
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "session.issues",
      "tab": "git",
      "label": "Issue del branch",
      "places": [
        "instances",
        "list",
        "card"
      ],
      "default": true
    },
    {
      "key": "instances.counts",
      "tab": "instances",
      "label": "Subagenti per stato",
      "places": [
        "instances",
        "list"
      ],
      "default": true
    },
    {
      "key": "instances.done",
      "tab": "instances",
      "label": "Terminati ancora in ufficio",
      "places": [
        "instances",
        "list"
      ],
      "default": true
    },
    {
      "key": "list.finishedToday",
      "tab": "instances",
      "label": "Terminati oggi, già usciti",
      "places": [
        "list"
      ],
      "default": true
    },
    {
      "key": "list.closedFinished",
      "tab": "instances",
      "label": "Terminati delle istanze chiuse",
      "places": [
        "list"
      ],
      "default": true
    },
    {
      "key": "today.list",
      "tab": "instances",
      "label": "Barra \"Oggi\" completa",
      "places": [
        "list"
      ],
      "default": true
    },
    {
      "key": "today.office",
      "tab": "instances",
      "label": "Barra \"Oggi\" compatta",
      "places": [
        "office"
      ],
      "default": true
    }
  ],
  "languages": [
    "system",
    "it",
    "en",
    "es"
  ]
};
