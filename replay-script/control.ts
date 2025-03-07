import { add_lib, Events } from "event_handler"

function doLog(msg: string) {
  print("REPLAY_SCRIPT:" + msg)
}

const events: {
  [K in keyof typeof defines.events]?: (
    this: void,
    event: (typeof defines.events)[K]["_eventData"],
  ) => void
} = {
  on_console_command(event) {
    const player =
      (event.player_index != undefined &&
        game.get_player(event.player_index)?.name) ||
      "server"
    doLog(`${player} ran command: /${event.command} ${event.parameters}`)
  },
}

const eventsTable: Events = {}
for (const [name, fn] of pairs(events)) {
  eventsTable[defines.events[name]] = fn as any
}

add_lib({ events: eventsTable })
