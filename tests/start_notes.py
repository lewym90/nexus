"""Testy starsze niż Pulpit zaczynają od listy notatek: każdy nowy kontekst przeglądarki dostaje to ustawienie."""
import playwright.sync_api._generated as _g
_orig = _g.Browser.new_context
def _new_context(self, *a, **k):
    ctx = _orig(self, *a, **k)
    ctx.add_init_script("try { if (!sessionStorage.getItem('nexus-test-home')) localStorage.setItem('nexus-start', 'notes'); } catch (e) {}")
    return ctx
_g.Browser.new_context = _new_context
