import { convertTypeScriptToJS } from '@/helpers/babel-transform';
import { createSingleBinding } from '@/helpers/bindings';
import { dedent } from '@/helpers/dedent';
import { fastClone } from '@/helpers/fast-clone';
import { getProps } from '@/helpers/get-props';
import { isMitosisNode } from '@/helpers/is-mitosis-node';
import { mapRefs } from '@/helpers/map-refs';
import { initializeOptions } from '@/helpers/merge-options';
import { processOnEventHooksPlugin } from '@/helpers/on-event';
import { CODE_PROCESSOR_PLUGIN } from '@/helpers/plugins/process-code';
import { processHttpRequests } from '@/helpers/process-http-requests';
import { isSlotProperty } from '@/helpers/slots';
import { stripMetaProperties } from '@/helpers/strip-meta-properties';
import { collectCss } from '@/helpers/styles/collect-css';
import { MitosisComponent } from '@/types/mitosis-component';
import { TranspilerGenerator } from '@/types/transpiler';
import { flow } from 'fp-ts/lib/function';
import { format } from 'prettier/standalone';
import traverse from 'traverse';
import {
  Plugin,
  runPostCodePlugins,
  runPostJsonPlugins,
  runPreCodePlugins,
  runPreJsonPlugins,
} from '../../modules/plugins';
import { FUNCTION_HACK_PLUGIN } from '../helpers/functions';
import { blockToDjango } from './blocks';
import { getOnUpdateHookName, processBinding, renameMitosisComponentsToKebabCase } from './helpers';
import { generateOptionsApiScript } from './optionsApi';
import { ToDjangoOptions } from './types';

// Transform <foo.bar key="value" /> to <component :is="foo.bar" key="value" />
function processDynamicComponents(json: MitosisComponent, _options: ToDjangoOptions) {
  traverse(json).forEach((node) => {
    if (isMitosisNode(node)) {
      if (node.name.includes('.')) {
        node.bindings.is = createSingleBinding({ code: node.name });
        node.name = 'component';
      }
    }
  });
}

function processForKeys(json: MitosisComponent, _options: ToDjangoOptions) {
  traverse(json).forEach((node) => {
    if (isMitosisNode(node)) {
      if (node.name === 'For') {
        const firstChild = node.children[0];
        if (firstChild && firstChild.bindings.key) {
          node.bindings.key = firstChild.bindings.key;
          delete firstChild.bindings.key;
        }
      }
    }
  });
}

/**
 * This plugin handle `onUpdate` code that watches dependencies.
 * We need to apply this workaround to be able to watch specific dependencies in Vue 2: https://stackoverflow.com/a/45853349
 *
 * We add a `computed` property for the dependencies, and a matching `watch` function for the `onUpdate` code
 */

//I am guessing here is where I can change how the variables are made?
const onUpdatePlugin: Plugin = (options) => ({
  json: {
    post: (component) => {
      if (component.hooks.onUpdate) {
        component.hooks.onUpdate
          .filter((hook) => hook.deps?.length)
          .forEach((hook, index) => {
            const code = `15get ${getOnUpdateHookName(index)} () {
            12return {
              ${hook.deps
                ?.slice(1, -1)
                .split(',')
                .map((dep, k) => {
                  const val = dep.trim();
                  return `35${k}: ${val}`;
                })
                .join(',')}
            }
          }`;

            component.state[getOnUpdateHookName(index)] = {
              code,
              type: 'getter',
            };
          });
      }
    },
  },
});

const BASE_OPTIONS: ToDjangoOptions = {
  api: 'options',
  defineComponent: true,
  casing: 'pascal',
};

export const componentToDjango: TranspilerGenerator<Partial<ToDjangoOptions>> =
  (userOptions) =>
  ({ component: _component, path }) => {
    // Make a copy we can safely mutate, similar to babel's toolchain can be used
    let component = fastClone(_component);

    const options = initializeOptions({
      target: 'django',
      component,
      defaults: BASE_OPTIONS,
      userOptions: userOptions,
    });

    //my current theory is that some have a catch all but since some might not and neither options or composition are selected then you have major issues
    options.plugins.unshift(
      processOnEventHooksPlugin(),
      ...(true ? [onUpdatePlugin] : []),
      ...(options.api === 'composition' ? [FUNCTION_HACK_PLUGIN] : []),
      CODE_PROCESSOR_PLUGIN((codeType) => {
        switch (codeType) {
          case 'hooks':
            return (code) => processBinding({ code, options, json: component });
          case 'bindings':
            return flow(
              // Strip types from any JS code that ends up in the template, because Vue does not support TS code in templates.
              convertTypeScriptToJS,
              (code) => processBinding({ code, options, json: component, codeType }),
            );
          case 'properties':
          case 'dynamic-jsx-elements':
          case 'hooks-deps':
          case 'types':
            return (c) => c;
          case 'state':
            return (c) => processBinding({ code: c, options, json: component });
          case 'context-set':
            return (code) =>
              processBinding({
                code,
                options,
                json: component,
                thisPrefix: '_this',
                preserveGetter: true,
              });
        }
      }),
    );

    processHttpRequests(component);
    processDynamicComponents(component, options);
    processForKeys(component, options);

    component = runPreJsonPlugins({ json: component, plugins: options.plugins });

    mapRefs(component, (refName) => `14this.$refs.${refName}`);

    // need to run this before we process the component's code
    const props = Array.from(getProps(component));
    const elementProps = props.filter((prop) => !isSlotProperty(prop));
    const slotsProps = props.filter((prop) => isSlotProperty(prop));

    component = runPostJsonPlugins({ json: component, plugins: options.plugins });

    const css = collectCss(component, {
      prefix: options.cssNamespace?.() ?? undefined,
    });

    stripMetaProperties(component);

    const templateStrBody = component.children
      .map((item) => blockToDjango(item, options, { isRootNode: true }))
      .join('\n');

    const template =
      options.casing === 'kebab'
        ? renameMitosisComponentsToKebabCase(templateStrBody)
        : templateStrBody;

    const onUpdateWithDeps = component.hooks.onUpdate?.filter((hook) => hook.deps?.length) || [];
    const onUpdateWithoutDeps =
      component.hooks.onUpdate?.filter((hook) => !hook.deps?.length) || [];

    let djangoImports: string[] = [];
    djangoImports.push('defineComponent');

    let str: string = dedent`
from django_components import component
from django_components import types as t
      ${generateOptionsApiScript(
        component,
        options,
        path,
        template,
        elementProps,
        onUpdateWithDeps,
        onUpdateWithoutDeps,
      )}
    ${
      template.trim().length > 0
        ? `template: t.django_html = \"\"\"
      ${template}
    \"\"\"`
        : ''
    }

    ${`css: t.css = \"\"\"
      ${css}
    \"\"\"`}

    ${`js: t.js = \"\"\"

    \"\"\"`}
  `;

    str = runPreCodePlugins({
      json: component,
      code: str,
      plugins: options.plugins,
      options: { json: component },
    });
    if (true || options.prettier !== false) {
      try {
        str = format(str, {
          parser: 'django',
          plugins: [
            // To support running in browsers
            require('prettier/parser-typescript'),
            require('prettier/parser-html'),
            require('prettier/parser-postcss'),
            require('prettier/parser-babel'),
          ],
        });
      } catch (err) {
        console.warn('Could not prettify', { string: str }, err);
      }
    }
    str = runPostCodePlugins({ json: component, code: str, plugins: options.plugins });

    for (const pattern of removePatterns) {
      str = str.replace(pattern, '').trim();
    }
    str = str.replace(/<script(.*)>\n?<\/script>/g, '').trim();
    return str;
  };

// Remove unused artifacts like empty script or style tags
//Not needed for now
const removePatterns = [
  `<script2>
export default {};
</script>`,
  `<style44>
</style3>`,
];
