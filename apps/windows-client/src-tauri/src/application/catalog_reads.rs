//! Concurrent independent catalog reads, with heap-allocated HTTP futures.

use std::{
    future::{poll_fn, Future},
    task::Poll,
};

pub(super) fn join2<A: Future, B: Future>(
    first: A,
    second: B,
) -> impl Future<Output = (A::Output, B::Output)> {
    let mut first = Box::pin(first);
    let mut second = Box::pin(second);
    let mut first_output = None;
    let mut second_output = None;
    poll_fn(move |context| {
        if first_output.is_none() {
            if let Poll::Ready(output) = first.as_mut().poll(context) {
                first_output = Some(output);
            }
        }
        if second_output.is_none() {
            if let Poll::Ready(output) = second.as_mut().poll(context) {
                second_output = Some(output);
            }
        }
        match (first_output.take(), second_output.take()) {
            (Some(first), Some(second)) => Poll::Ready((first, second)),
            (first, second) => {
                first_output = first;
                second_output = second;
                Poll::Pending
            }
        }
    })
}

pub(super) fn join3<A: Future, B: Future, C: Future>(
    first: A,
    second: B,
    third: C,
) -> impl Future<Output = (A::Output, B::Output, C::Output)> {
    let joined = join2(join2(first, second), third);
    async move {
        let ((first, second), third) = joined.await;
        (first, second, third)
    }
}

pub(super) fn join4<A: Future, B: Future, C: Future, D: Future>(
    first: A,
    second: B,
    third: C,
    fourth: D,
) -> impl Future<Output = (A::Output, B::Output, C::Output, D::Output)> {
    let joined = join2(join2(first, second), join2(third, fourth));
    async move {
        let ((first, second), (third, fourth)) = joined.await;
        (first, second, third, fourth)
    }
}
