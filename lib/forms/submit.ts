import { startTransition, type FormEvent } from "react";

/**
 * Submits a form to a server action WITHOUT React 19's automatic form reset (which would wipe
 * what the member typed whenever the server answers with an error). `prepare` can add fields.
 */
export function submitWithoutReset(
  dispatch: (form: FormData) => void,
  prepare?: (form: FormData) => void,
) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    prepare?.(form);
    startTransition(() => dispatch(form));
  };
}
