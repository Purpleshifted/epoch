# Edge Visibility Debug

## Issue
The connecting lines (edges) between nodes in the NoiseCraft editor are not visible in the embedded version.

## How Edges Should Work

1. **Edge Creation**: When a project loads via `model.load()`, it broadcasts the state to all views, including the Editor
2. **Editor.update()**: The Editor's `update()` method is called, which:
   - Creates all UI nodes
   - Creates Edge objects for each connection in `newState.nodes`
   - Adds edges to the SVG element: `this.svg.appendChild(edge.line)`
   - Calls `resize()` to size the SVG properly

3. **Edge Rendering**: Each Edge object:
   - Creates an SVG `<path>` element
   - Calculates bezier curve points between source and destination ports
   - Sets stroke color and width
   - Calls `render()` to draw the path

## Current Implementation

The edges **should** be created when:
- `app.setState(initialState)` is called
- This calls `model.load(initialState)`
- Which calls `this.broadcast(this.state, null)`
- Which calls `editor.update(newState, null)`
- Which creates edges and adds them to the SVG

## Potential Issues

1. **SVG Not Sized**: The SVG might not have proper width/height attributes set
2. **SVG Not Visible**: CSS might be hiding the SVG or it might be positioned incorrectly
3. **Edges Outside Viewport**: Edges might be rendered but outside the visible area
4. **Timing Issue**: Edges might be created before nodes are positioned correctly
5. **Override Interference**: The `editor.update()` override might be interfering with edge creation

## Debug Steps

1. Open browser console and check:
   - `document.getElementById("graph_svg").children.length` - should show number of edges
   - `document.getElementById("graph_svg").getAttribute("width")` - should have a value
   - `document.getElementById("graph_svg").getAttribute("height")` - should have a value

2. Check if edges exist in DOM:
   ```javascript
   Array.from(document.getElementById("graph_svg").children).forEach(edge => {
     console.log(edge.tagName, edge.getAttribute("d"));
   });
   ```

3. Verify SVG styling:
   - Check computed CSS for `graph_svg` element
   - Verify `z-index: -2` is set (should be behind nodes)
   - Verify `position: absolute` is set

## Next Steps

If edges exist in the DOM but aren't visible:
- Check SVG dimensions match graph_div dimensions
- Verify edges have valid path data in the `d` attribute
- Check if stroke color is visible (default is `#ccc`)

If edges don't exist:
- The update() method might not be called correctly
- The override might be preventing edge creation
- The project state might not have connections defined



