import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { MdNode } from '../core/markdown';
import { STRINGS } from '../i18n/strings';

/**
 * Renders the allow-listed tree from `MarkdownRenderer` (F02-AC8) with plain Angular templates:
 * no `innerHTML`, so everything that is not an explicit element is escaped text. Links carry
 * `rel="noopener noreferrer nofollow"`, `target="_blank"` and a visually hidden "(opens in new tab)".
 *
 * The recursion goes through one template, not nested components: a component host element between
 * a `ul` and its `li` would break the list structure for assistive technology.
 */
@Component({
  selector: 'app-markdown-nodes',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *ngTemplateOutlet="tree; context: { $implicit: nodes() }" />
    <ng-template #tree let-list>
      @for (node of list; track $index) {
        @switch (node.kind) {
          @case ('text') {
            <ng-container>{{ node.text }}</ng-container>
          }
          @case ('br') {
            <br />
          }
          @case ('hr') {
            <hr />
          }
          @case ('code') {
            <code>{{ node.text }}</code>
          }
          @case ('pre') {
            <pre><code>{{ node.text }}</code></pre>
          }
          @case ('link') {
            <a [href]="node.href" target="_blank" rel="noopener noreferrer nofollow"
              ><ng-container *ngTemplateOutlet="tree; context: { $implicit: node.children }" /><span
                class="visually-hidden"
              >
                {{ t.opensInNewTab }}</span
              ></a
            >
          }
          @case ('el') {
            @switch (node.tag) {
              @case ('p') {
                <p>
                  <ng-container *ngTemplateOutlet="tree; context: { $implicit: node.children }" />
                </p>
              }
              @case ('em') {
                <em
                  ><ng-container *ngTemplateOutlet="tree; context: { $implicit: node.children }"
                /></em>
              }
              @case ('strong') {
                <strong
                  ><ng-container *ngTemplateOutlet="tree; context: { $implicit: node.children }"
                /></strong>
              }
              @case ('s') {
                <s
                  ><ng-container *ngTemplateOutlet="tree; context: { $implicit: node.children }"
                /></s>
              }
              @case ('blockquote') {
                <blockquote>
                  <ng-container *ngTemplateOutlet="tree; context: { $implicit: node.children }" />
                </blockquote>
              }
              @case ('ul') {
                <ul>
                  <ng-container *ngTemplateOutlet="tree; context: { $implicit: node.children }" />
                </ul>
              }
              @case ('ol') {
                <ol [attr.start]="node.start ?? null">
                  <ng-container *ngTemplateOutlet="tree; context: { $implicit: node.children }" />
                </ol>
              }
              @case ('li') {
                <li>
                  <ng-container *ngTemplateOutlet="tree; context: { $implicit: node.children }" />
                </li>
              }
              @case ('h4') {
                <h4>
                  <ng-container *ngTemplateOutlet="tree; context: { $implicit: node.children }" />
                </h4>
              }
            }
          }
        }
      }
    </ng-template>
  `,
})
export class MarkdownNodes {
  protected readonly t = STRINGS.stories;
  readonly nodes = input.required<readonly MdNode[]>();
}
