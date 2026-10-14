import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { MdNode } from '../core/markdown';
import { STRINGS } from '../i18n/strings';

/**
 * Renders the allow-listed tree from `MarkdownRenderer` (F02-AC8) with plain Angular templates:
 * no `innerHTML`, so everything that is not an explicit element is escaped text. Links carry
 * `rel="noopener noreferrer nofollow"`, `target="_blank"` and a visually hidden "(opens in new tab)".
 */
@Component({
  selector: 'app-markdown-nodes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (node of nodes(); track $index) {
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
            ><app-markdown-nodes [nodes]="node.children" /><span class="visually-hidden">
              {{ t.opensInNewTab }}</span
            ></a
          >
        }
        @case ('el') {
          @switch (node.tag) {
            @case ('p') {
              <p><app-markdown-nodes [nodes]="node.children" /></p>
            }
            @case ('em') {
              <em><app-markdown-nodes [nodes]="node.children" /></em>
            }
            @case ('strong') {
              <strong><app-markdown-nodes [nodes]="node.children" /></strong>
            }
            @case ('s') {
              <s><app-markdown-nodes [nodes]="node.children" /></s>
            }
            @case ('blockquote') {
              <blockquote><app-markdown-nodes [nodes]="node.children" /></blockquote>
            }
            @case ('ul') {
              <ul>
                <app-markdown-nodes [nodes]="node.children" />
              </ul>
            }
            @case ('ol') {
              <ol [attr.start]="node.start ?? null">
                <app-markdown-nodes [nodes]="node.children" />
              </ol>
            }
            @case ('li') {
              <li><app-markdown-nodes [nodes]="node.children" /></li>
            }
            @case ('h4') {
              <h4><app-markdown-nodes [nodes]="node.children" /></h4>
            }
          }
        }
      }
    }
  `,
})
export class MarkdownNodes {
  protected readonly t = STRINGS.stories;
  readonly nodes = input.required<readonly MdNode[]>();
}
