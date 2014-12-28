/**
 * In lieu of a being able to register transformers into JSX,
 * we use a mixin. The "dangerous" part is an outright lie,
 * but that's simply React's decision - any HTML, whether it's
 * something the user has zero control over or not, is
 * considered dangerous. It might not know that CSP catches
 * everything that unsafe HTML still lets through.
 */
var MarkDownMixin = {
  markdown: function(string) {
    return {
      dangerouslySetInnerHTML: {
        __html : markdown.toHTML(string)
      }
    };
  }
};