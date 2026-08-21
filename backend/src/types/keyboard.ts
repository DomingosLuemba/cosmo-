/**
 * Eventos que o telefone envia e o agente do Mac injeta via CGEvent.
 * Espelhado em `mac-agent/Sources/CosmoMacAgent/InputEvent.swift` e em
 * `ios-app/CosmoController/RemoteKeyboard/MacInputEvent.swift` — os três
 * precisam ficar em sincronia.
 */
export type MacModifier = "command" | "shift" | "option" | "control" | "function";

/**
 * Teclas sem caractere imprimível. O agente traduz cada nome para o virtual
 * keycode correspondente (constantes de `Carbon.HIToolbox`), que não dependem
 * do layout do teclado.
 */
export const NAMED_KEYS = [
  "return",
  "enter",
  "tab",
  "space",
  "delete",
  "forwardDelete",
  "escape",
  "left",
  "right",
  "up",
  "down",
  "home",
  "end",
  "pageUp",
  "pageDown",
  "f1", "f2", "f3", "f4", "f5", "f6",
  "f7", "f8", "f9", "f10", "f11", "f12",
] as const;

export type NamedKey = (typeof NAMED_KEYS)[number];

/**
 * `text` é o caminho comum de digitação: o agente usa
 * `CGEventKeyboardSetUnicodeString`, que independe do layout e aceita
 * acentuação e emoji. `key` existe para teclas nomeadas e atalhos
 * (ex: `{ key: "c", modifiers: ["command"] }`), onde o keycode real importa.
 */
export type MacInputEvent =
  | { type: "text"; text: string }
  | { type: "key"; key: string; modifiers?: MacModifier[] };

export interface MacAgentInfo {
  id: string;
  name: string;
  online: boolean;
  pairedAt?: string;
}
