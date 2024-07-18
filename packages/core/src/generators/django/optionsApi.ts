import { getComponentsUsed } from '@/helpers/get-components-used';
import { getCustomImports } from '@/helpers/get-custom-imports';
import { getStateObjectStringFromComponent } from '@/helpers/get-state-object-string';
import { checkIsDefined } from '@/helpers/nullable';
import { checkIsComponentImport } from '@/helpers/render-imports';
import { BaseHook, MitosisComponent } from '@/types/mitosis-component';
import json5 from 'json5';
import { kebabCase, uniq } from 'lodash';
import { encodeQuotes, getContextKey, getContextValue } from './helpers';
import { DjangoDefaultProps, DjangoPropsDefinition, ToDjangoOptions } from './types';

const getContextProvideString = (json: MitosisComponent, options: ToDjangoOptions) => {
  return `{
    ${Object.values(json.context.set)
      .map((setVal) => {
        const key = getContextKey(setVal);
        return `[${key}]: ${getContextValue(setVal)}`;
      })
      .join(',')}
  }`;
};

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
      return `'${componentName}': ${componentName}`;
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
}) => dataString.replace(/}$/, `${newContent}}`);

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

  const getterString = getStateObjectStringFromComponent(component, {
    data: false,
    getters: true,
    functions: false,
  });

  let functionsString = getStateObjectStringFromComponent(component, {
    data: false,
    getters: false,
    functions: true,
  });

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
    let str = ` def get_context_data(`;
    str += `${json5.stringify(props)}):
    `;
    str += `return {
    }`;
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
          return `${prop}: { default: ${value} }`;
        })
        .join(',');

      str += `{${defalutPropsString}}`;
    } else {
      str += `${json5.stringify(propsDefinition)}`;
    }
    return `${str},`;
  };

  return `
  ${
    getterString.length < 4
      ? ''
      : `
  computed: ${getterString},
  `
  }
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
`;
}
