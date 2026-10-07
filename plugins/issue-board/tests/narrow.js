import { cells } from '../hooks/parse';
const isNode = (value) => typeof value === 'object' && value !== null && typeof value.type === 'string';
const kids = (node) => (node.children ?? []).filter(child => typeof child === 'string' || isNode(child));
const num = (value) => (typeof value === 'number' ? value : 0);
// What must stay on one line: a number such as `#123`, with the arrow or mark before it (`→ #12`, `⛔ #4`), diff counts
// (`+12 −3`), a count such as `2/5`, and a key hint such as `[ x ]`. A link's label, a badge (inverse text) and a
// framed button are kept whole on top of these.
const ATOMS = [/\+\d+ [−-]\d+/g, /(?:[→⇄⛔⚙↳] )?#\d+/g, /(?<![\w/])[+−]\d+/g, /\d+\/\d+/g, /\[ [^\]]{1,3} \]/g];
const hasTruncate = (wrap) => typeof wrap === 'string' && wrap !== 'wrap';
// A Text's characters, nested Text and Links inline, with the ranges that must stay whole: links, badges, and every
// match of ATOMS.
const flatten = (node) => {
    let text = '';
    const atoms = [];
    const walk = (one, whole) => {
        if (typeof one === 'string') {
            text += one;
            return;
        }
        if (!isNode(one))
            return;
        const start = text.length;
        if (one.type === 'Link')
            text += String(one.props.label ?? one.props.href ?? '');
        else
            for (const child of kids(one))
                walk(child, whole);
        if (one.type === 'Link' || (one.props.inverse && !whole))
            atoms.push([start, text.length]);
    };
    for (const child of kids(node))
        walk(child, false);
    if (node.props.inverse)
        atoms.push([0, text.length]);
    for (const pattern of ATOMS)
        for (const found of text.matchAll(pattern))
            atoms.push([found.index ?? 0, (found.index ?? 0) + found[0].length]);
    return { text, atoms: atoms.map(([start, end]) => trim(text, start, end)).filter(([start, end]) => end > start) };
};
// A badge such as ` ✓ PASS ` keeps its padding, but only what is between the spaces has to stay together.
const trim = (text, start, end) => {
    while (start < end && text[start] === ' ')
        start += 1;
    while (end > start && text[end - 1] === ' ')
        end -= 1;
    return [start, end];
};
// What a Button draws on the terminal: `[ label ]`, or plain, `h: label` or the label alone.
const buttonText = (node) => {
    const label = String(node.props.label ?? '');
    if (!node.props.plain)
        return `[ ${label} ]`;
    return node.props.hotkey ? `${String(node.props.hotkey)}: ${label}` : label;
};
const widest = (text) => Math.max(0, ...text.split('\n').map(cells));
// Where a greedy word wrap at `width` cells breaks `text`: each break is the index of the first character on the next
// line, or of the space the break swallowed.
export const breaks = (text, width) => {
    const found = [];
    let at = 0;
    for (const line of text.split('\n')) {
        let used = 0;
        let index = at;
        for (const word of line.split(' ')) {
            const size = cells(word);
            if (used > 0 && used + 1 + size > width) {
                found.push(index - 1);
                used = 0;
            }
            else if (used > 0)
                used += 1;
            // A word wider than the line is cut where the line ends.
            let offset = 0;
            for (const char of word) {
                const each = cells(char);
                if (used > 0 && used + each > width) {
                    found.push(index + offset);
                    used = 0;
                }
                used += each;
                offset += char.length;
            }
            index += word.length + 1;
        }
        at += line.length + 1;
    }
    return found;
};
const margins = (node) => {
    if (!isNode(node) || node.type !== 'Box')
        return 0;
    const { props } = node;
    const side = (one) => num(one ?? props.marginX ?? props.margin);
    return side(props.marginLeft) + side(props.marginRight);
};
const paddings = (props) => {
    const side = (one) => num(one ?? props.paddingX ?? props.padding);
    return side(props.paddingLeft) + side(props.paddingRight) + (props.borderStyle ? 2 : 0);
};
const inFlow = (node) => kids(node).filter(child => !(isNode(child) && child.type === 'Box' && (child.props.position === 'absolute' || child.props.display === 'none')));
// The width an element takes when nothing squeezes it.
const natural = (node) => {
    if (typeof node === 'string')
        return widest(node);
    if (!isNode(node))
        return 0;
    switch (node.type) {
        case 'Text':
            return widest(flatten(node).text);
        case 'Button':
            return cells(buttonText(node));
        case 'Link':
            return cells(String(node.props.label ?? node.props.href ?? ''));
        case 'Box': {
            if (typeof node.props.width === 'number')
                return node.props.width;
            const children = inFlow(node);
            const sizes = children.map(child => natural(child) + margins(child));
            const row = !String(node.props.flexDirection ?? 'row').startsWith('column');
            const gap = num(node.props.columnGap ?? node.props.gap);
            const inner = row ? sizes.reduce((sum, size) => sum + size, 0) + gap * Math.max(0, children.length - 1) : Math.max(0, ...sizes);
            return inner + paddings(node.props);
        }
        default:
            // Markdown, an Input and the like wrap or scroll their own text, so they ask for no room of their own.
            return 0;
    }
};
// The drawn tree with every element given props, as some leaves come without.
const normal = (node) => {
    if (typeof node !== 'object' || node === null || typeof node.type !== 'string')
        return node;
    const one = node;
    return { type: one.type, props: one.props ?? {}, children: (one.children ?? []).map(normal) };
};
// Every place in the tree where something that must stay on one line can break, laid out `width` cells wide.
export const splitAtoms = (drawn, width) => {
    const found = [];
    const tree = normal(drawn);
    const text = (node, room) => {
        const flat = node.type === 'Text' ? flatten(node) : node.type === 'Link' ? { text: String(node.props.label ?? ''), atoms: [] } : undefined;
        const shown = flat ?? { text: buttonText(node), atoms: [] };
        // A framed button and a bare link stay whole; a plain button's label is checked as text.
        const atoms = node.type === 'Link' || (node.type === 'Button' && !node.props.plain) ? [[0, shown.text.length]] : node.type === 'Button' ? flatten({ type: 'Text', props: {}, children: [shown.text] }).atoms : shown.atoms;
        if (hasTruncate(node.props.wrap) || widest(shown.text) <= room)
            return;
        const cuts = breaks(shown.text, Math.max(1, room));
        for (const [start, end] of atoms)
            if (cuts.some(cut => cut > start && cut < end))
                found.push({ text: shown.text, atom: shown.text.slice(start, end), room });
    };
    const lay = (node, room) => {
        if (!isNode(node))
            return;
        if (node.type === 'Text' || node.type === 'Button' || node.type === 'Link')
            return text(node, room);
        if (node.type !== 'Box')
            return;
        const own = typeof node.props.width === 'number' ? node.props.width : room;
        const inner = Math.max(0, own - paddings(node.props));
        const children = kids(node);
        // A placed card, or a Box hidden until hovered, takes no room among its siblings; laid out on its own, it has the
        // width it names or the whole row.
        const flowing = inFlow(node);
        for (const child of children)
            if (!flowing.includes(child))
                lay(child, isNode(child) && typeof child.props.width === 'number' ? child.props.width : inner);
        if (String(node.props.flexDirection ?? 'row').startsWith('column')) {
            for (const child of flowing)
                lay(child, inner - margins(child));
            return;
        }
        const sizes = flowing.map(child => natural(child) + margins(child));
        const gap = num(node.props.columnGap ?? node.props.gap);
        const total = sizes.reduce((sum, size) => sum + size, 0) + gap * Math.max(0, flowing.length - 1);
        const wraps = node.props.flexWrap === 'wrap';
        const over = wraps ? 0 : total - inner;
        const shrink = (child) => (isNode(child) && child.type === 'Box' ? num(child.props.flexShrink ?? 1) : 1);
        const weight = flowing.reduce((sum, child, index) => sum + shrink(child) * (sizes[index] ?? 0), 0);
        flowing.forEach((child, index) => {
            const size = sizes[index] ?? 0;
            const given = wraps ? Math.min(size, inner) : over > 0 && weight > 0 ? size - (over * shrink(child) * size) / weight : size;
            lay(child, Math.floor(given) - margins(child));
        });
    };
    lay(tree, width);
    return found;
};
// Fails naming every split, so a new row is covered by adding it to the fixture.
export const assertNoSplitAtoms = (tree, width) => {
    const found = splitAtoms(tree, width);
    if (found.length > 0)
        throw new Error(`At ${width} columns:\n${found.map(one => `  "${one.atom}" can split in "${one.text}" (${one.room} cells)`).join('\n')}`);
};
