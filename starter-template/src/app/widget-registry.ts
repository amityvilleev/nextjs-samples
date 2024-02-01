import { WidgetRegistry, initRegistry, defaultWidgetRegistry } from '@progress/sitefinity-nextjs-sdk';
// import { HelloWorld } from './components/hello-world/hello-world';
// import { HelloWorldEntity } from './components/hello-world/hello-world.entity';

const customWidgetRegistry: WidgetRegistry = {
    widgets: {
        // 'HelloWorld': {
        //     componentType: HelloWorld, // registration of the widget
        //     entity: HelloWorldEntity, // registration of the designer
        //     ssr: true, // whether this is a server rendered or client rendered component
        //     editorMetadata: {
        //         Title: 'Hello World'
        //     }
        // }
    }
};


Object.keys(defaultWidgetRegistry.widgets).forEach((key) => {
    customWidgetRegistry.widgets[key] = defaultWidgetRegistry.widgets[key];
});

export const widgetRegistry: WidgetRegistry = initRegistry(customWidgetRegistry);
