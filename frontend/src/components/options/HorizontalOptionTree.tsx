import React, { useId } from 'react';
import { OptionNode } from '../viewer/optionTree';
import { txt } from '../viewer/decodeEntities';

export interface HorizontalOptionTreeProps {
  nodes: OptionNode[];
  selected: ReadonlySet<number>;
  onToggle: (optionId: number) => void;
  /** Read-only rendering: ticks still show, clicks do nothing. */
  disabled?: boolean;
  /** Distinguishes checkbox ids when several groups share a page. */
  idPrefix?: string;
}

const OptionChip: React.FC<{
  node: OptionNode;
  selected: ReadonlySet<number>;
  onToggle: (optionId: number) => void;
  disabled?: boolean;
  inputId: string;
  className?: string;
}> = ({ node, selected, onToggle, disabled, inputId, className = '' }) => {
  const id = node.option.id;
  const checked = typeof id === 'number' && selected.has(id);

  return (
    <div
      className={`hopt-opt ${checked ? 'on' : ''} ${className}`}
      onClick={(e) => {
        if (e.target instanceof HTMLInputElement) return;
        if (!disabled && typeof id === 'number') {
          e.preventDefault();
          onToggle(id);
        }
      }}
    >
      <input
        id={inputId}
        type="checkbox"
        className="hopt-check"
        checked={checked}
        disabled={disabled}
        onChange={() => typeof id === 'number' && onToggle(id)}
      />
      <label htmlFor={inputId} className="hopt-label">
        {txt(node.option.option_label)}
      </label>
    </div>
  );
};

export const HorizontalOptionTree: React.FC<HorizontalOptionTreeProps> = ({
  nodes,
  selected,
  onToggle,
  disabled,
  idPrefix
}) => {
  const generatedId = useId();
  const prefix = idPrefix || `hopt${generatedId.replace(/:/g, '')}`;

  if (nodes.length === 0) return null;

  // Selected nodes at level 0 that have children
  const openWithChildren = nodes.filter(
    (n) =>
      typeof n.option.id === 'number' &&
      selected.has(n.option.id) &&
      n.children &&
      n.children.length > 0
  );

  return (
    <div className="hopt-tree-root">
      {/* Root options row */}
      <div className="hopt-options-wrap hopt-scroll hopt-row-scroll" role="group">
        {nodes.map((node, i) => (
          <OptionChip
            key={node.option.id ?? i}
            node={node}
            selected={selected}
            onToggle={onToggle}
            disabled={disabled}
            inputId={`${prefix}-${node.option.id ?? `root-${i}`}`}
          />
        ))}
      </div>

      {/* Subtrees of selected parent nodes */}
      {openWithChildren.map((parentNode) => {
        const hasCategories = parentNode.children.some(
          (c) => c.children && c.children.length > 0
        );

        if (!hasCategories) {
          // All children are leaf options (e.g. Sputum? -> Clear, White, Yellow...)
          return (
            <div
              key={parentNode.option.id}
              className="hopt-child-container"
              data-parent={parentNode.option.option_label}
            >
              <div className="hopt-options-wrap hopt-scroll hopt-row-scroll" role="group">
                {parentNode.children.map((childNode, ci) => (
                  <OptionChip
                    key={childNode.option.id ?? ci}
                    node={childNode}
                    selected={selected}
                    onToggle={onToggle}
                    disabled={disabled}
                    inputId={`${prefix}-${childNode.option.id ?? `c-${ci}`}`}
                  />
                ))}
              </div>
            </div>
          );
        }

        // Parent has category branches (e.g. Chest Pain? -> CCS, With Exertion, At Rest)
        return (
          <div
            key={parentNode.option.id}
            className="hopt-child-container"
            data-parent={parentNode.option.option_label}
          >
            <div className="hopt-categories-container">
              {parentNode.children.map((catNode, ci) => {
                const catHasChildren = catNode.children && catNode.children.length > 0;
                const catId = catNode.option.id;
                const catInputId = `${prefix}-${catId ?? `cat-${ci}`}`;

                if (!catHasChildren) {
                  // Leaf option at category level (e.g. At Rest)
                  return (
                    <div
                      key={catId ?? ci}
                      className="hopt-category-group hopt-leaf-group"
                    >
                      <OptionChip
                        node={catNode}
                        selected={selected}
                        onToggle={onToggle}
                        disabled={disabled}
                        inputId={catInputId}
                      />
                    </div>
                  );
                }

                // Category with child options (e.g. CCS, With Exertion)
                return (
                  <div key={catId ?? ci} className="hopt-category-group">
                    <div className="hopt-category-header">
                      <OptionChip
                        node={catNode}
                        selected={selected}
                        onToggle={onToggle}
                        disabled={disabled}
                        inputId={catInputId}
                        className="hopt-category-chip"
                      />
                    </div>
                    <div className="hopt-options-wrap hopt-category-children">
                      {catNode.children.map((subNode, si) => {
                        const subHasChildren =
                          subNode.children && subNode.children.length > 0;
                        const subId = subNode.option.id;
                        const subInputId = `${prefix}-${subId ?? `sub-${ci}-${si}`}`;

                        if (!subHasChildren) {
                          // Standard leaf child option (e.g. Class I..IV, Running, Walking up Stairs)
                          return (
                            <OptionChip
                              key={subId ?? si}
                              node={subNode}
                              selected={selected}
                              onToggle={onToggle}
                              disabled={disabled}
                              inputId={subInputId}
                            />
                          );
                        }

                        // Subgroup that has its own children (e.g. Walking on Flat Surface -> More than 1/2 km...)
                        return (
                          <div key={subId ?? si} className="hopt-subgroup">
                            <div className="hopt-subgroup-header">
                              <OptionChip
                                node={subNode}
                                selected={selected}
                                onToggle={onToggle}
                                disabled={disabled}
                                inputId={subInputId}
                                className="hopt-subgroup-chip"
                              />
                            </div>
                            <div className="hopt-options-wrap hopt-subgroup-options">
                              {subNode.children.map((deepNode, di) => {
                                const deepId = deepNode.option.id;
                                const deepInputId = `${prefix}-${deepId ?? `deep-${ci}-${si}-${di}`}`;
                                return (
                                  <OptionChip
                                    key={deepId ?? di}
                                    node={deepNode}
                                    selected={selected}
                                    onToggle={onToggle}
                                    disabled={disabled}
                                    inputId={deepInputId}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
