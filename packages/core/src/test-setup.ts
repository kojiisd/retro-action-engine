// Vitest setup for core: the Fx range assertions are always on in tests (ADR-0002).
import { setChecks } from './fx/fx';

setChecks(true);
