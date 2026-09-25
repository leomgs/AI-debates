import { createInterface } from 'node:readline';
import { hashPassword } from '../src/shared/crypto/scrypt-password';

// API-8 (ADR 0001 punto 2) — genera el valor de CURATOR_PASSWORD_HASH.
// Correr con: pnpm --filter @ai-trend-debates/api auth:hash-password
//
// La contraseña no se acepta como argumento a propósito (quedaría en el
// historial del shell y en la lista de procesos). En una terminal interactiva
// se pide sin eco; si stdin no es una TTY (pipe, o algunas terminales de
// Windows como mintty/Git Bash sin winpty), se lee la primera línea de stdin:
//   echo "mi-contraseña" | pnpm --filter @ai-trend-debates/api auth:hash-password
// Por stdout sale solo la línea lista para el .env (los mensajes van a
// stderr), para poder redirigirla.

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    // readline no tiene modo "sin eco": se silencia la escritura de lo que
    // tipea el usuario, dejando pasar solo el texto de la pregunta.
    const internal = rl as unknown as { _writeToOutput: (s: string) => void };
    let asked = false;
    internal._writeToOutput = (s: string) => {
      if (!asked) {
        process.stderr.write(s);
        asked = true;
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
  });
}

function readFirstLineFromStdin(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    let resolved = false;
    rl.once('line', (line) => {
      resolved = true;
      rl.close();
      resolve(line);
    });
    rl.once('close', () => {
      if (!resolved) resolve('');
    });
  });
}

async function main() {
  let password: string;
  if (process.stdin.isTTY) {
    password = await promptHidden('Contraseña del curador: ');
    const confirmation = await promptHidden('Repetila: ');
    if (password !== confirmation) {
      console.error('Las contraseñas no coinciden.');
      process.exit(1);
    }
  } else {
    console.error('stdin no es una terminal: leyendo la contraseña de la primera línea de stdin.');
    password = (await readFirstLineFromStdin()).replace(/\r$/, '');
  }

  if (password.length < 8) {
    console.error('La contraseña tiene que tener al menos 8 caracteres.');
    process.exit(1);
  }

  const hash = await hashPassword(password);
  console.error('Pegá esta línea en apps/api/.env:');
  process.stdout.write(`CURATOR_PASSWORD_HASH=${hash}\n`);
}

main().catch((err) => {
  console.error('hash-password falló', err);
  process.exit(1);
});
