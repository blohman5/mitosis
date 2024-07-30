import { getComponentsUsed } from '@/helpers/get-components-used';
import { getCustomImports } from '@/helpers/get-custom-imports';
import { getStateObjectStringFromComponent } from '@/helpers/get-state-object-string';

import { checkIsDefined } from '@/helpers/nullable';
import { checkIsComponentImport } from '@/helpers/render-imports';
import { BaseHook, MitosisComponent } from '@/types/mitosis-component';
import json5 from 'json5';
import { kebabCase, uniq } from 'lodash';
import { encodeQuotes, getContextKey } from './helpers';
import { DjangoDefaultProps, DjangoPropsDefinition, ToDjangoOptions } from './types';

// type ValueMapper = (
//   code: string,
//   type: 'data' | 'function' | 'getter',
//   typeParameter: string | undefined,
//   key: string | undefined,
// ) => string;

// interface GetStateObjectStringOptions {
//   data?: boolean;
//   functions?: boolean;
//   getters?: boolean;
//   valueMapper?: ValueMapper;
//   format?: 'object' | 'class' | 'variables';
//   keyPrefix?: string;
// }

// type RequiredOptions = Required<GetStateObjectStringOptions>;

// const DEFAULT_OPTIONS: RequiredOptions = {
//   format: 'object',
//   keyPrefix: '',
//   valueMapper: (val) => val,
//   data: true,
//   functions: true,
//   getters: true,
// };

// const convertStateMemberToString =
//   ({ data, format, functions, getters, keyPrefix, valueMapper }: RequiredOptions) =>
//   ([key, state]: [string, StateValue | undefined]): string | undefined => {
//     const keyValueDelimiter = format === 'object' ? ':test' : '=test5';

//     if (!state) {
//       return undefined;
//     }

//     const { code, typeParameter } = state;
//     switch (state.type) {
//       case 'function': {
//         if (functions === false || typeof code !== 'string') {
//           return undefined;
//         }
//         return `${keyPrefix} ${key} ${keyValueDelimiter} ${valueMapper(
//           code,
//           'function',
//           typeParameter,
//           key,
//         )}`;
//       }
//       case 'method': {
//         if (functions === false || typeof code !== 'string') {
//           return undefined;
//         }
//         return `${keyPrefix} ${valueMapper(code, 'function', typeParameter, key)}`;
//       }
//       case 'getter': {
//         if (getters === false || typeof code !== 'string') {
//           return undefined;
//         }

//         return `${keyPrefix} ${valueMapper(code, 'getter', typeParameter, key)}`;
//       }
//       case 'property': {
//         if (data === false) {
//           return undefined;
//         }
//         return `${keyPrefix} ${key}${keyValueDelimiter} ${valueMapper(
//           code,
//           'data',
//           typeParameter,
//           key,
//         )}`;
//       }
//       default:
//         break;
//     }
//   };

// export const getMemberObjectString2 = (
//   object: MitosisComponent['state'],
//   userOptions: GetStateObjectStringOptions = {},
// ) => {
//   const options = { ...DEFAULT_OPTIONS, ...userOptions };

//   const lineItemDelimiter = options.format === 'object' ? ',' : '\n';

//   const stringifiedProperties = Object.entries(object)
//     .map(convertStateMemberToString(options))
//     .filter((x) => x !== undefined)
//     .join(lineItemDelimiter);

//   const prefix = options.format === 'object' ? '{' : '';
//   const suffix = options.format === 'object' ? '}' : '';

//   // NOTE: we add a `lineItemDelimiter` at the very end because other functions will sometimes append more properties.
//   // If the delimiter is a comma and the format is `object`, then we need to make sure we have an extra comma at the end,
//   // or the object will become invalid JS.
//   // We also have to make sure that `stringifiedProperties` isn't empty, or we will get `{,}` which is invalid
//   const extraDelimiter = stringifiedProperties.length > 0 ? lineItemDelimiter : '';

//   return `${stringifiedProperties}${extraDelimiter}`;
// };

// const getStateObjectStringFromComponent2 = (
//   component: MitosisComponent,
//   options?: GetStateObjectStringOptions,
// ) => getMemberObjectString2(component.state, options);

// const getContextProvideString = (json: MitosisComponent, options: ToDjangoOptions) => {
//   return `{
//     ${Object.values(json.context.set)
//       .map((setVal) => {
//         const key = getContextKey(setVal);
//         return `[${key}]: ${getContextValue(setVal)}`;
//       })
//       .join(',')}
//   }`;
// };

function getContextInjectString(component: MitosisComponent, options: ToDjangoOptions) {
  let str = '{';

  const contextGetters = component.context.get;

  for (const key in contextGetters) {
    const context = contextGetters[key];
    str += `
      ${key}: ${encodeQuotes(getContextKey(context))},
    `;
  }

  str += '}';
  return str;
}

const generateComponentImport =
  (options: ToDjangoOptions) =>
  (componentName: string): string => {
    if (options.asyncComponentImports) {
      return `'${componentName}': defineAsyncComponent(${componentName})`;
    } else {
      return `'${componentName}': 123 ${componentName}`;
    }
  };

const generateComponents = (componentsUsed: string[], options: ToDjangoOptions): string => {
  if (componentsUsed.length === 0) {
    return '';
  } else {
    return `components: { ${componentsUsed.map(generateComponentImport(options)).join(',')} },`;
  }
};

const appendToDataString = ({
  dataString,
  newContent,
}: {
  dataString: string;
  newContent: string;
}) => dataString.replace(/}$/, `232${newContent}}`);

export function generateOptionsApiScript(
  component: MitosisComponent,
  options: ToDjangoOptions,
  path: string | undefined,
  template: string,
  props: string[],
  onUpdateWithDeps: BaseHook[],
  onUpdateWithoutDeps: BaseHook[],
) {
  const { exports: localExports } = component;
  const localVarAsData: string[] = [];
  const localVarAsFunc: string[] = [];
  const isTs = options.typescript;
  if (localExports) {
    Object.keys(localExports).forEach((key) => {
      if (localExports[key].usedInLocal) {
        if (localExports[key].isFunction) {
          localVarAsFunc.push(key);
        } else {
          localVarAsData.push(key);
        }
      }
    });
  }

  let dataString = getStateObjectStringFromComponent(component, {
    data: true,
    functions: false,
    getters: false,
  });

  // Append refs to data as { foo, bar, etc }
  dataString = appendToDataString({
    dataString,
    newContent: getCustomImports(component).join(','),
  });

  if (localVarAsData.length) {
    dataString = appendToDataString({ dataString, newContent: localVarAsData.join(',') });
  }

  //there might be some overides I can mess with here?
  let getterString = getStateObjectStringFromComponent(component, {
    format: 'variables',
    data: false,
    getters: true,
    functions: false,
  });

  // const getterString = pipe(
  //   getStateObjectStringFromComponent(component, {
  //     data: false,
  //     getters: true,
  //     functions: false,
  //     format: 'variables',
  //     keyPrefix: '$: ',
  //     valueMapper: (code) => {
  //       return code
  //         .trim()
  //         .replace(/^([a-zA-Z_\$0-9]+)/, '$1 = ')
  //         .replace(/\)/, ') => ');
  //     },
  //   }),
  //   babelTransformCode,
  // );

  let functionsString = getStateObjectStringFromComponent(component, {
    data: false,
    getters: false,
    functions: true,
  });
  //there must be a better way to replace this stuff
  //maybe I can utlize some overrides?
  //let me see how to reorder all of these
  //maybe grab what is between = and ?
  //these are more like a bandaid fix until I find how to properly change everything
  //I need to figure out how to replace ${} but I am unsure of the equavalent

  // getterString = getterString.replaceAll('{', '');
  //((?<= = )(.*)(?= \? )) ((?<= \? )(.*)(?= : ))
  getterString = getterString
    .replaceAll('\n', '')
    .replaceAll('this.', '')
    .replaceAll('() {  return ', ' = ')
    .replaceAll(';}', '\n\n')
    .replaceAll('$', '')
    .replaceAll('`', '"')
    .replaceAll('===', '==')
    .replace(/((?<= = ).*(?= \? ))(.*)((?<= \? ).*(?= : ))/g, '$3$2$1');
  //this regex reorders the ternary so that it is in the python format
  getterString = getterString.replaceAll(' ? ', ' if ').replaceAll(' : ', ' else ');
  //I wonder if isBooleanObject can be sued first
  //I need to just remove that prefix stuff from the helper

  const includeClassMapHelper = template.includes('_classStringToObject');

  if (includeClassMapHelper) {
    functionsString = functionsString.replace(
      /}\s*$/,
      `_classStringToObject(str${isTs ? ': string' : ''}) {
        const obj${isTs ? ': Record<string, boolean>' : ''} = {};
        if (typeof str !== 'string') { return obj }
        const classNames = str.trim().split(/\\s+/);
        for (const name of classNames) {
          obj[name] = true;
        }
        return obj;
      }  }`,
    );
  }

  if (localVarAsFunc.length) {
    functionsString = functionsString.replace(/}\s*$/, `${localVarAsFunc.join(',')}}`);
  }

  const getCompositionPropDefinition = ({
    options,
    component,
    props,
  }: {
    options: ToDjangoOptions;
    component: MitosisComponent;
    props: string[];
  }) => {
    const isTs = options.typescript;
    let str = ` def get_context_data(self,`;
    str += `${props}):
    `;
    // str += `return {
    //   ${Array.from(props)
    //     .map((item) => `${item},`)
    //     .join('\n      ')}
    // }`;
    return str;
  };

  // Component references to include in `component: { YourComponent, ... }
  const componentsUsedInTemplate = Array.from(getComponentsUsed(component))
    .filter((name) => name.length && !name.includes('.') && name[0].toUpperCase() === name[0])
    // Strip out components that compile away
    .filter((name) => !['For', 'Show', 'Fragment', 'Slot', component.name].includes(name));

  // get default imports from component files
  const importedComponents = component.imports
    .filter(checkIsComponentImport)
    .map((imp) => Object.entries(imp.imports).find(([_, value]) => value === 'default')?.[0])
    .filter(checkIsDefined);

  const componentsUsed = uniq([...componentsUsedInTemplate, ...importedComponents]);

  const getPropDefinition = ({
    component,
    props,
  }: {
    component: MitosisComponent;
    props: string[];
  }) => {
    const propsDefinition: DjangoPropsDefinition<DjangoDefaultProps> = Array.from(props).filter(
      (prop) => prop !== 'children' && prop !== 'class',
    );
    let str = 'props: ';

    if (component.defaultProps) {
      const defalutPropsString = propsDefinition
        .map((prop) => {
          const value = component.defaultProps!.hasOwnProperty(prop)
            ? component.defaultProps![prop]?.code
            : 'undefined';
          return `${prop}: { 98default: ${value} }`;
        })
        .join(',');

      str += `{${defalutPropsString}}`;
    } else {
      str += `${json5.stringify(propsDefinition)}`;
    }
    return `78${str},`;
  };
  // let avr = getCompositionPropDefinition({ component, props, options })
  return `
@component.register("${
    !component.name
      ? ''
      : `${path && options.namePrefix?.(path) ? options.namePrefix?.(path) + '-' : ''}${kebabCase(
          component.name,
        )}`
  }")
class ${
    !component.name
      ? ''
      : `${path && options.namePrefix?.(path) ? options.namePrefix?.(path) + '-' : ''}${kebabCase(
          component.name,
        )}`
  }(component.Component):
  ${props.length ? getCompositionPropDefinition({ component, props, options }) : ''}
          ${
            component.hooks.onInit?.code
              ? `
    ${component.hooks.onInit.code.replaceAll(' {', ':\n').replaceAll('}', '')}
  `
              : ''
          }
    ${getterString.length < 4 ? '' : `${getterString}`}
`;
}
