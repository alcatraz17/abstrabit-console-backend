import { ValidationError } from '../common/errors.js';

export function fieldErrors(issues) {
  const fields = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || 'form';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

export function validate(schemas) {
  return (req, _res, next) => {
    const valid = {};
    const fields = {};
    for (const [part, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) valid[part] = result.data;
      else Object.assign(fields, fieldErrors(result.error.issues));
    }
    if (Object.keys(fields).length > 0) return next(new ValidationError(undefined, fields));
    req.valid = { ...(req.valid ?? {}), ...valid };
    return next();
  };
}
