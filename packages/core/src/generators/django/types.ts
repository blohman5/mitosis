import { BaseTranspilerOptions } from '@/types/transpiler';

//types seem to be controlled here but how?
export type DjangoApi = 'options' | 'composition';

export interface ToDjangoOptions extends BaseTranspilerOptions {
  cssNamespace?: () => string;
  namePrefix?: (path: string) => string;
  asyncComponentImports?: boolean;
  defineComponent?: boolean;
  api: DjangoApi;
  convertClassStringToObject?: boolean;
  casing?: 'pascal' | 'kebab';
}

export type DjangoProp<T> =
  | { (): T }
  | { new (...args: never[]): T & object }
  | { new (...args: string[]): Function };
export type DjangoPropType<T> = DjangoProp<T> | DjangoProp<T>[];
export type DjangoPropValidator<T> = DjangoPropOptions<T> | DjangoPropType<T>;

export interface DjangoPropOptions<T = any> {
  type?: DjangoPropType<T>;
  required?: boolean;
  default?: T | null | undefined | (() => T | null | undefined);
  validator?(value: T): boolean;
}

export type DjangoDefaultProps = Record<string, any>;
export type DjangoRecordPropsDefinition<T> = {
  [K in keyof T]: DjangoPropValidator<T[K]>;
};
export type DjangoArrayPropsDefinition<T> = (keyof T)[];
export type DjangoPropsDefinition<T> =
  | DjangoArrayPropsDefinition<T>
  | DjangoRecordPropsDefinition<T>;
