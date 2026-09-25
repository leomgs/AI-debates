import { readCookie, sessionCookieOptions } from "./session-cookie";

describe("session-cookie", () => {
  describe("readCookie", () => {
    it("devuelve undefined sin header o sin la cookie buscada", () => {
      expect(readCookie(undefined, "atd_session")).toBeUndefined();
      expect(readCookie("", "atd_session")).toBeUndefined();
      expect(readCookie("otra=1; tercera=2", "atd_session")).toBeUndefined();
    });

    it("encuentra la cookie entre varias, tolerando espacios", () => {
      expect(readCookie("a=1; atd_session=123.abc ;b=2", "atd_session")).toBe("123.abc");
      expect(readCookie("atd_session=123.abc", "atd_session")).toBe("123.abc");
    });

    it("no confunde un nombre que solo contiene al buscado", () => {
      expect(readCookie("x_atd_session=malo; atd_session_old=malo", "atd_session")).toBeUndefined();
    });

    it("gana la primera aparición si el nombre se repite", () => {
      expect(readCookie("atd_session=primero; atd_session=segundo", "atd_session")).toBe("primero");
    });

    it("decodifica percent-encoding y comillas, y tolera secuencias inválidas", () => {
      expect(readCookie("atd_session=%31%32", "atd_session")).toBe("12");
      expect(readCookie('atd_session="123.abc"', "atd_session")).toBe("123.abc");
      expect(readCookie("atd_session=%E0%A4%A", "atd_session")).toBe("%E0%A4%A");
    });
  });

  it("opciones: httpOnly, SameSite=Lax, Path=/, sin Domain y Secure según el parámetro", () => {
    expect(sessionCookieOptions(false)).toEqual({ httpOnly: true, sameSite: "lax", path: "/", secure: false });
    expect(sessionCookieOptions(true)).toEqual({ httpOnly: true, sameSite: "lax", path: "/", secure: true });
    expect(sessionCookieOptions(true)).not.toHaveProperty("domain");
  });
});
