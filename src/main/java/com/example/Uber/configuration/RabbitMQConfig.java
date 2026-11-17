package com.example.Uber.configuration;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Configuration
public class RabbitMQConfig {

    // v2: the queue now carries dead-letter arguments, and RabbitMQ will not redeclare an existing queue with different ones.
    public static final String QUEUE = "ride.requests.v2.q";
    public static final String DEAD_LETTER_EXCHANGE = "ride.requests.dlx";
    public static final String DEAD_LETTER_QUEUE = "ride.requests.dlq";

    @Bean
    public Queue rideRequestQueue() {
        // A message that keeps failing is rejected (not requeued) and lands in the DLQ instead of looping forever.
        return QueueBuilder.durable(QUEUE)
                .deadLetterExchange(DEAD_LETTER_EXCHANGE)
                .deadLetterRoutingKey(DEAD_LETTER_QUEUE)
                .build();
    }

    @Bean
    public DirectExchange deadLetterExchange() {
        return new DirectExchange(DEAD_LETTER_EXCHANGE, true, false);
    }

    @Bean
    public Queue deadLetterQueue() {
        return QueueBuilder.durable(DEAD_LETTER_QUEUE).build();
    }

    @Bean
    public Binding deadLetterBinding() {
        return BindingBuilder.bind(deadLetterQueue()).to(deadLetterExchange()).with(DEAD_LETTER_QUEUE);
    }

    // Java <-> JSON for message bodies
    @Bean
    public Jackson2JsonMessageConverter messageConverter() {
        return new Jackson2JsonMessageConverter();
    }

    @Bean
    public RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(messageConverter());
        // Unroutable messages come back through the returns callback instead of vanishing.
        template.setMandatory(true);
        template.setConfirmCallback((correlation, ack, cause) -> {
            if (!ack) {
                log.error("Broker rejected message {} cause={}", correlation == null ? "?" : correlation.getId(), cause);
            }
        });
        template.setReturnsCallback(returned ->
                log.error("Message not routed to any queue routingKey={} replyText={}",
                        returned.getRoutingKey(), returned.getReplyText()));
        return template;
    }
}
