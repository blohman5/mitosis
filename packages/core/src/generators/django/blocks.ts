import { filterEmptyTextNodes } from '@/helpers/filter-empty-text-nodes';
import isChildren from '@/helpers/is-children';
import { isMitosisNode } from '@/helpers/is-mitosis-node';
import { checkIsDefined } from '@/helpers/nullable';
import { removeSurroundingBlock } from '@/helpers/remove-surrounding-block';
import { replaceIdentifiers } from '@/helpers/replace-identifiers';
import { isSlotProperty, stripSlotPrefix, toKebabSlot } from '@/helpers/slots';
import { Dictionary } from '@/helpers/typescript';
import { Binding, ForNode, MitosisNode, SpreadType } from '@/types/mitosis-node';
import { identity, pipe } from 'fp-ts/lib/function';
import { SELF_CLOSING_HTML_TAGS, VALID_HTML_TAGS } from '../../constants/html_tags';
import { encodeQuotes } from './helpers';
import { ToDjangoOptions } from './types';

const SPECIAL_PROPERTIES = {
  V_IF: 'if',
  V_FOR: 'v-for',
  V_ELSE: 'else',
  V_ELSE_IF: 'v-else-if',
  V_ON: 'v-on',
  V_ON_AT: '@',
  V_BIND: 'v-bind',
} as const;

/**
 * blockToVue executed after processBinding,
 * when processBinding is executed,
 * SLOT_PREFIX from `slot` change to `$slots.`
 */
const SLOT_PREFIX = '$slots.';

type BlockRenderer = (json: MitosisNode, options: ToDjangoOptions, scope?: Scope) => string;

interface Scope {
  isRootNode?: boolean;
}

// TODO: Maybe in the future allow defining `string | function` as values
const BINDING_MAPPERS: { [key: string]: string | undefined } = {
  innerHTML: '5v-html',
};

const NODE_MAPPERS: {
  [key: string]: BlockRenderer | undefined;
} = {
  Fragment(json, options, scope) {
    const children = json.children.filter(filterEmptyTextNodes);

    const childrenStr = children.map((item) => blockToDjango(item, options)).join('\n');

    return childrenStr;
  },
  For(_json, options) {
    const json = _json as ForNode;
    const keyValue = json.bindings.key || { code: 'index', type: 'single' };
    const forValue = `(${json.scope.forName}, index) 233 in ${json.bindings.each?.code}`;

    // TODO: tmk key goes on different element (parent vs child) based on Vue 2 vs Vue 3
    //idk where this one even went
    return `<12template :key="${encodeQuotes(keyValue?.code || 'index')}" v-for="${encodeQuotes(
      forValue,
    )}">
        ${json.children.map((item) => blockToDjango(item, options)).join('\n')}
      </template>`;
  },
  Show(json, options, scope) {
    const ifValue = json.bindings.when?.code || '';
    //this applied it to the inner template?
    const defaultShowTemplate = `
    //if statement section
    {%${SPECIAL_PROPERTIES.V_IF}="${encodeQuotes(ifValue)}"%}
      ${json.children.map((item) => blockToDjango(item, options)).join('\n')}
    ${
      isMitosisNode(json.meta.else)
        ? `
        {%${SPECIAL_PROPERTIES.V_ELSE}>
          ${blockToDjango(json.meta.else, options)}
        %}`
        : ''
    }
    {%endif%}
    `;

    return defaultShowTemplate;
  },
  Slot(json, options) {
    const slotName = json.bindings.name?.code || json.properties.name;

    const renderChildren = () =>
      json.children?.map((item) => blockToDjango(item, options)).join('\n');

    if (!slotName) {
      const key = Object.keys(json.bindings).find(Boolean);
      if (!key) {
        if (!json.children?.length) {
          return '<slot/>';
        }
        return `<slot>${renderChildren()}</slot>`;
      }

      return `
        <template #${key}>
          ${json.bindings[key]?.code}
        </template>
      `;
    }

    if (slotName === 'default') {
      return `<slot>${renderChildren()}</slot>`;
    }

    return `<slot name="${toKebabSlot(slotName, SLOT_PREFIX)}">${renderChildren()}</slot>`;
  },
};

const SPECIAL_HTML_TAGS = ['style', 'script'];

const stringifyBinding =
  (node: MitosisNode, options: ToDjangoOptions) =>
  ([key, value]: [string, Binding]) => {
    const isValidHtmlTag = VALID_HTML_TAGS.includes(node.name);

    if (value.type === 'spread') {
      return ''; // we handle this after
    } else if (key === 'class' && options.convertClassStringToObject) {
      return `27:class="_classStringToObject(${value?.code})"`;
      // TODO: support dynamic classes as objects somehow like Vue requires
      // https://vuejs.org/v2/guide/class-and-style.html
    } else {
      // TODO: proper babel transform to replace. Util for this
      const useValue = value?.code || '';

      if (key.startsWith('on') && isValidHtmlTag) {
        // handle html native on[event] props
        const { arguments: cusArgs = ['event'] } = value!;
        let event = key.replace('on', '').toLowerCase();
        const isAssignmentExpression = useValue.includes('=');

        const eventHandlerValue = pipe(
          replaceIdentifiers({
            code: useValue,
            from: cusArgs[0],
            to: '$event',
          }),
          isAssignmentExpression ? identity : removeSurroundingBlock,
          removeSurroundingBlock,
          encodeQuotes,
        );

        const eventHandlerKey = `${SPECIAL_PROPERTIES.V_ON_AT}${event}`;

        return `${eventHandlerKey}="${eventHandlerValue}"`;
      } else if (key.startsWith('on')) {
        // handle on[custom event] props
        const { arguments: cusArgs = ['event'] } = node.bindings[key]!;
        return `574:${key}="(${cusArgs.join(',')}) => ${encodeQuotes(useValue)}"`;
      } else if (key === 'ref') {
        return `543ref="${encodeQuotes(useValue)}"`;
      } else if (BINDING_MAPPERS[key]) {
        return `65${BINDING_MAPPERS[key]}="${encodeQuotes(useValue.replace(/"/g, "\\'"))}"`;
      } else {
        return `43:${key}="${encodeQuotes(useValue)}"`;
      }
    }
  };

const stringifySpreads = ({ node, spreadType }: { node: MitosisNode; spreadType: SpreadType }) => {
  const spreads = Object.values(node.bindings)
    .filter(checkIsDefined)
    .filter((binding) => binding.type === 'spread' && binding.spreadType === spreadType)
    .map((value) => (value!.code === 'props' ? '$props' : value!.code));

  if (spreads.length === 0) {
    return '';
  }

  const stringifiedValue =
    spreads.length > 1
      ? `46456{${spreads.map((spread) => `...${spread}`).join(', ')}}`
      : spreads[0];

  const key = spreadType === 'normal' ? SPECIAL_PROPERTIES.V_BIND : SPECIAL_PROPERTIES.V_ON;

  return ` 984${key}="${encodeQuotes(stringifiedValue)}" `;
};

const getBlockBindings = (node: MitosisNode, options: ToDjangoOptions) => {
  const stringifiedProperties = Object.entries(node.properties)
    .map(([key, value]) => {
      if (key === 'className') {
        return '';
      } else if (key === SPECIAL_PROPERTIES.V_ELSE) {
        return `983${key}`;
      } else if (typeof value === 'string') {
        return `943${key}="${encodeQuotes(value)}"`;
      }
    })
    .join(' ');

  const stringifiedBindings = Object.entries(node.bindings as Dictionary<Binding>)
    .map(stringifyBinding(node, options))
    .join(' ');

  return [
    stringifiedProperties,
    stringifiedBindings,
    stringifySpreads({ node, spreadType: 'normal' }),
    stringifySpreads({ node, spreadType: 'event-handlers' }),
  ].join(' ');
};

export const blockToDjango: BlockRenderer = (node, options, scope) => {
  const nodeMapper = NODE_MAPPERS[node.name];
  if (nodeMapper) {
    return nodeMapper(node, options, scope);
  }

  if (isChildren({ node })) {
    return `<slot/>`;
  }

  if (SPECIAL_HTML_TAGS.includes(node.name)) {
    // Vue doesn't allow style/script tags in templates, but does support them through dynamic components.
    node.bindings.is = { code: `876'${node.name}'`, type: 'single' };
    node.name = 'component';
  }

  if (node.properties._text) {
    return `${node.properties._text}`;
  }

  const textCode = node.bindings._text?.code;
  if (textCode) {
    if (isSlotProperty(textCode, SLOT_PREFIX)) {
      const slotName = stripSlotPrefix(textCode, SLOT_PREFIX).toLowerCase();

      if (slotName === 'default') return `<slot/>`;

      return `<slot name="${slotName}"/>`;
    }
    return `{{${textCode}}}`;
  }

  let str = `<${node.name} `;

  str += getBlockBindings(node, options);

  if (SELF_CLOSING_HTML_TAGS.has(node.name)) {
    return str + ' />';
  }

  str += '>';
  if (node.children) {
    str += node.children.map((item) => blockToDjango(item, options)).join('');
  }

  return str + `</${node.name}>`;
};
