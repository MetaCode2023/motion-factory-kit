"""Optional Manim shot for compositing with M.video()."""
from manim import Create, Dot, Scene, TAU, Text, TracedPath, ValueTracker, VGroup, Axes
from manim import DOWN, UP, TEAL_A, WHITE, config, linear
import math


class SineTrace(Scene):
    def construct(self):
        self.camera.background_color = "#101820"
        axes = Axes(x_range=[0, TAU, math.pi / 2], y_range=[-1.2, 1.2, 1],
                    x_length=config.frame_width * 0.78, y_length=3, tips=False)
        title = Text("Tracing a sine wave", font_size=34, color=WHITE)
        VGroup(title, axes).arrange(DOWN, buff=0.7).shift(UP)
        self.add(title)
        phase = ValueTracker(0)
        point = Dot(color=TEAL_A)
        point.add_updater(lambda dot: dot.move_to(
            axes.c2p(phase.get_value(), math.sin(phase.get_value()))
        ))
        self.play(Create(axes), run_time=0.6)
        point.update()
        self.add(TracedPath(point.get_center, stroke_color=TEAL_A), point)
        self.play(phase.animate.set_value(TAU), run_time=3, rate_func=linear)
        self.wait(0.4)
